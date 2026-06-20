/* =========================================================
   かもしてぽん！一本仕込み（いっぽんじこみ）モード プロトタイプ
   1ゲームで「たった1本のお酒」を醸す。点を稼ぐのではなく、
   収穫で「かおり／こく」の2軸を伸ばし、一本の個性を造る。
   ・のみごろ（純米酒）で収穫 → こく
   ・ピーク（大吟醸）で収穫   → かおり
   依存ライブラリなし（Vanilla JS）
   ========================================================= */

(() => {
  "use strict";

  // ---------- 定数定義 ----------
  const SIZE = 6;            // 盤面 6x6
  const START_MOVES = 30;    // 持ち手数
  const MATCH_POINT = 10;    // 素材1つ消すごとの基本点（演出用の小さなスコア）

  // 一本仕込みの2軸。収穫ステージごとに伸びる軸が変わる
  const AXIS = { KAORI: "kaori", KOKU: "koku" };

  // 素材タイル（やさしい名前で統一。♨️🧊は特殊パネル＝色つき）
  const TYPES = [
    { id: "kome",    emoji: "🌾", name: "お米" },
    { id: "mizu",    emoji: "💧", name: "お水" },
    { id: "bio",     emoji: "🦠", name: "びせいぶつ" },
    { id: "atsu",    emoji: "♨️", name: "あっため", panel: "warm" },
    { id: "hiyashi", emoji: "🧊", name: "ひやし", panel: "cold" },
  ];

  // 発酵ステージ定義（gauge は 0〜5、6でお酢になる）
  // axis/amount = 収穫したときに伸びる軸と量
  const GAUGE_MAX = 5;
  const STAGES = {
    young: { range: [0, 2], cls: "stage-young", harvestName: "あまざけ", axis: AXIS.KOKU,  amount: 2 },
    ready: { range: [3, 4], cls: "stage-ready", harvestName: "純米酒",   axis: AXIS.KOKU,  amount: 6 },
    peak:  { range: [5, 5], cls: "stage-peak",  harvestName: "大吟醸",   axis: AXIS.KAORI, amount: 12 },
  };
  const FERMENT_HEAVY_CHANCE = 0.35; // 発酵が一気に+2すすむ「きまぐれ」の確率
  const NIGORI_PENALTY = 4;          // お酢が1つできるたび、酒の出来がにごる量

  // 素材の力（樽・お酢の8近傍でマッチしたときの効果）
  const EFFECT_BOOST_TYPE = "atsu";    // ♨️あっため：となりの樽の発酵+1
  const EFFECT_COOL_TYPE = "hiyashi";  // 🧊ひやし：となりの樽の発酵-1
  const EFFECT_WASH_TYPE = "mizu";     // 💧お水：となりのお酢を洗い流す

  // 注文（目標スペック）：今回どんな一本を造ってほしいか。1ゲームに1つ
  const ORDER_POOL = [
    { id: "kaori", wish: "華やかな一本がほしい", hint: "かおりを高く（ピークでたくさん収穫）" },
    { id: "koku",  wish: "ふくよかな一本がほしい", hint: "こくを高く（のみごろでたくさん収穫）" },
    { id: "balance", wish: "ととのった一本がほしい", hint: "かおりとこくをバランスよく" },
  ];

  // 酒の格（かおり＋こくの合計で決まる。にごりは合計から差し引く）
  const GRADE_TIERS = [
    { min: 0,  name: "普通酒" },
    { min: 28, name: "純米酒" },
    { min: 55, name: "吟醸" },
    { min: 90, name: "大吟醸" },
  ];
  // 個性の名前プール（かおり寄り / こく寄り / ととのった）
  const SAKE_NAMES = {
    kaori:   ["花あかり", "春がすみ", "うたかた", "そよ風"],
    koku:    ["大黒柱", "ふところ", "土の詩", "蔵の主"],
    balance: ["まんまる", "なかよし", "ひだまり", "やまびこ"],
  };

  // 樽置き場（同時に持てる樽の数。少ないほど1樽が大事になる）
  const BARREL_CAP = 4;
  // 大物マッチのごほうび：4つ消し=でか樽（中身×2）、5つ消し=金樽（中身×3）
  const BARREL_MULT_QUAD = 2;
  const BARREL_MULT_PENTA = 3;
  // まとめてぽん！（くっついた樽の同時収穫倍率：2つ=×1.5、3つ以上=×2）
  const GROUP_MULT_PAIR = 1.5;
  const GROUP_MULT_TRIO = 2;

  const BEST_KEY = "kamoshitepon_ippon_best_v1";

  // ---------- 状態 ----------
  let board = [];        // board[row][col] = タイル or null
  let score = 0;         // 演出用（ゴールではない）
  let kaori = 0;         // かおり軸
  let koku = 0;          // こく軸
  let nigori = 0;        // にごり（お酢によるマイナス）
  let moves = START_MOVES;
  let order = null;      // 今ゲームの注文（目標スペック）
  let selected = null;   // {r, c} 選択中セル
  let busy = false;      // アニメーション中の入力ロック
  let gameOver = false;

  // ---------- DOM ----------
  const boardEl = document.getElementById("board");
  const scoreEl = document.getElementById("score");
  const movesEl = document.getElementById("moves");
  const comboEl = document.getElementById("combo");
  const statusEl = document.getElementById("statusLine");
  const toastLayer = document.getElementById("toastLayer");

  const helpModal = document.getElementById("helpModal");
  const resultModal = document.getElementById("resultModal");

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const randType = () => Math.floor(Math.random() * TYPES.length);

  // ---------- タイル生成 ----------
  const makeTile = (type) => ({ kind: "normal", type });
  const makeBarrel = (gauge, mult = 1) => ({ kind: "barrel", gauge, mult });
  const makeVinegar = () => ({ kind: "vinegar" });

  function stageOf(barrel) {
    if (barrel.gauge >= STAGES.peak.range[0]) return STAGES.peak;
    if (barrel.gauge >= STAGES.ready.range[0]) return STAGES.ready;
    return STAGES.young;
  }

  // ---------- 盤面初期化（初手マッチなしになるまで置き直し） ----------
  function initBoard() {
    board = [];
    for (let r = 0; r < SIZE; r++) {
      board.push([]);
      for (let c = 0; c < SIZE; c++) {
        board[r].push(makeTile(randType()));
      }
    }
    // 初期マッチを潰す
    while (findMatches().length > 0) {
      for (const group of findMatches()) {
        const { r, c } = group.cells[0];
        board[r][c] = makeTile(randType());
      }
    }
  }

  // ---------- マッチ判定（3つ以上の連なりをグループで返す） ----------
  function findMatches() {
    const groups = [];
    const scan = (cells) => {
      let run = [];
      const flush = () => {
        if (run.length >= 3) {
          groups.push({ cells: [...run], len: run.length });
        }
        run = [];
      };
      let prevType = null;
      for (const { r, c } of cells) {
        const t = board[r][c];
        const type = t && t.kind === "normal" ? t.type : null;
        if (type !== null && type === prevType) {
          run.push({ r, c });
        } else {
          flush();
          run = type !== null ? [{ r, c }] : [];
        }
        prevType = type;
      }
      flush();
    };

    for (let r = 0; r < SIZE; r++) {
      scan(Array.from({ length: SIZE }, (_, c) => ({ r, c })));
    }
    for (let c = 0; c < SIZE; c++) {
      scan(Array.from({ length: SIZE }, (_, r) => ({ r, c })));
    }
    return groups;
  }

  // ---------- 詰み判定（入れかえでマッチが作れる手があるか） ----------
  function hasValidMove() {
    const trySwap = (r1, c1, r2, c2) => {
      const a = board[r1][c1];
      const b = board[r2][c2];
      if (!a || !b || a.kind !== "normal" || b.kind !== "normal") return false;
      [board[r1][c1], board[r2][c2]] = [b, a];
      const ok = findMatches().length > 0;
      [board[r1][c1], board[r2][c2]] = [a, b];
      return ok;
    };
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (c + 1 < SIZE && trySwap(r, c, r, c + 1)) return true;
        if (r + 1 < SIZE && trySwap(r, c, r + 1, c)) return true;
      }
    }
    return false;
  }

  // ---------- 描画 ----------
  function render(extraClasses = {}) {
    // まとめてぽん予告：くっついている樽のかたまりサイズを数えておく
    const clusterSize = {};
    {
      const counted = new Set();
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const t = board[r][c];
          if (!t || t.kind !== "barrel" || counted.has(`${r},${c}`)) continue;
          const cluster = collectCluster(r, c);
          for (const p of cluster) {
            counted.add(`${p.r},${p.c}`);
            clusterSize[`${p.r},${p.c}`] = cluster.length;
          }
        }
      }
    }

    boardEl.innerHTML = "";
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.r = r;
        cell.dataset.c = c;
        const t = board[r][c];

        if (t === null) {
          cell.style.visibility = "hidden";
        } else if (t.kind === "normal") {
          const type = TYPES[t.type];
          cell.textContent = type.emoji;
          cell.title = type.name;
          // ♨️🧊は特殊パネル（パネル色で「道具タイル」だと伝える）
          if (type.panel) cell.classList.add(`special-${type.panel}`);
        } else if (t.kind === "barrel") {
          const stage = stageOf(t);
          cell.classList.add("barrel", stage.cls);
          cell.textContent = "🍶";
          // でか樽（×2）・金樽（×3）：見た目と×nバッジが利点を教える
          const mult = t.mult || 1;
          if (mult >= 2) {
            cell.classList.add(mult >= 3 ? "gold" : "big");
            const qb = document.createElement("span");
            qb.className = "quality-badge";
            qb.textContent = `×${mult}`;
            cell.appendChild(qb);
          }
          const barrelName = mult >= 3 ? "金樽" : mult >= 2 ? "でか樽" : "仕込み樽";
          cell.title = `${barrelName}（${stage.harvestName}どき）`;
          // この樽を今しぼると、どっちの軸が伸びるかをタイル上で教える
          const ab = document.createElement("span");
          ab.className = stage.axis === AXIS.KAORI ? "axis-badge kaori" : "axis-badge koku";
          ab.textContent = stage.axis === AXIS.KAORI ? "香" : "こく";
          cell.appendChild(ab);
          // まとめてぽん予告バッジ（2つ以上くっついているとき）
          const size = clusterSize[`${r},${c}`] || 1;
          if (size >= 2) {
            const badge = document.createElement("span");
            badge.className = "cluster-badge";
            badge.textContent = `×${size}`;
            cell.appendChild(badge);
          }
          // 発酵ゲージの点々
          const gauge = document.createElement("div");
          gauge.className = "gauge";
          for (let i = 1; i <= GAUGE_MAX; i++) {
            const dot = document.createElement("i");
            if (t.gauge >= i) dot.classList.add("on");
            gauge.appendChild(dot);
          }
          cell.appendChild(gauge);
        } else if (t.kind === "vinegar") {
          cell.classList.add("vinegar");
          cell.textContent = "🫙";
          cell.title = "お酢…酒がにごる（タップでかたづけ手数1／💧で洗えばタダ）";
        }

        const key = `${r},${c}`;
        if (extraClasses[key]) cell.classList.add(extraClasses[key]);
        if (selected && selected.r === r && selected.c === c) {
          cell.classList.add("selected");
        }
        cell.addEventListener("pointerdown", onCellTap);
        boardEl.appendChild(cell);
      }
    }
    scoreEl.textContent = kaori;   // HUD左：かおり
    comboEl.textContent = koku;    // HUD右：こく
    movesEl.textContent = moves;
    updateStatusLine();
  }

  function countBarrels() {
    let n = 0;
    for (const row of board) {
      for (const t of row) {
        if (t && t.kind === "barrel") n++;
      }
    }
    return n;
  }

  // ---------- 酒の出来を計算（プレビューと結果で共用） ----------
  function brewResult() {
    const total = Math.max(0, kaori + koku - nigori);
    let grade = GRADE_TIERS[0].name;
    for (const t of GRADE_TIERS) if (total >= t.min) grade = t.name;

    // 個性：かおりとこくのかたより
    let character;
    if (kaori > koku * 1.3) character = "kaori";
    else if (koku > kaori * 1.3) character = "koku";
    else character = "balance";

    const adj =
      character === "kaori" ? "華やかな" : character === "koku" ? "ふくよかな" : "ととのった";
    return { total, grade, character, adj };
  }

  function updateStatusLine() {
    const b = brewResult();
    const nigoriTxt = nigori > 0 ? `（にごり -${nigori}）` : "";
    statusEl.textContent = `いまこんなお酒 → ${b.adj}${b.grade}${nigoriTxt}`;
  }

  // コンボ表示はこく軸スロットに譲ったため、連鎖はトーストで伝える（ここは何もしない）
  function showCombo() {}

  // ---------- 手数の増減をHUDにふわっと表示 ----------
  function flashMoves(delta) {
    if (!delta) return;
    const hud = movesEl.parentElement;
    const f = document.createElement("span");
    f.className = `moves-float ${delta > 0 ? "plus" : "minus"}`;
    f.textContent = delta > 0 ? `+${delta}` : `${delta}`;
    hud.appendChild(f);
    setTimeout(() => f.remove(), 900);
  }

  // ---------- トースト表示 ----------
  function toast(msg, offsetIndex = 0) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    el.style.top = `${36 + offsetIndex * 40}%`;
    toastLayer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  // ---------- 入力 ----------
  function onCellTap(e) {
    if (busy || gameOver) return;
    const r = Number(e.currentTarget.dataset.r);
    const c = Number(e.currentTarget.dataset.c);
    const t = board[r][c];
    if (!t) return;

    // 樽：タップで収穫（手数を使わないフリーアクション）
    if (t.kind === "barrel") {
      harvestBarrel(r, c);
      return;
    }
    // お酢：タップでかたづけ
    if (t.kind === "vinegar") {
      clearVinegar(r, c);
      return;
    }

    // 素材：選択 → となりを選んだら入れかえ
    if (selected === null) {
      selected = { r, c };
      render();
      return;
    }
    const isSame = selected.r === r && selected.c === c;
    const isAdjacent =
      Math.abs(selected.r - r) + Math.abs(selected.c - c) === 1;

    if (isSame) {
      selected = null;
      render();
    } else if (isAdjacent) {
      const from = selected;
      selected = null;
      trySwap(from, { r, c });
    } else {
      selected = { r, c };
      render();
    }
  }

  // ---------- 入れかえ ----------
  async function trySwap(a, b) {
    busy = true;
    const ta = board[a.r][a.c];
    const tb = board[b.r][b.c];
    [board[a.r][a.c], board[b.r][b.c]] = [tb, ta];
    render();
    await sleep(120);

    if (findMatches().length === 0) {
      // マッチしないなら元に戻す（手数は消費しない）
      [board[a.r][a.c], board[b.r][b.c]] = [ta, tb];
      render();
      busy = false;
      return;
    }

    // 手を消費 → 既存の樽が発酵 → 連鎖解決
    moves--;
    fermentAll();
    await resolveBoard(b);   // 入れかえ先を樽の発生基準点にする
    await afterAction();
  }

  // ---------- 発酵（1手ごとに+1か+2の「きまぐれ」、満タン超えはお酢に） ----------
  function fermentAll() {
    let soured = false;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const t = board[r][c];
        if (t && t.kind === "barrel") {
          t.gauge += Math.random() < FERMENT_HEAVY_CHANCE ? 2 : 1;
          if (t.gauge > GAUGE_MAX) {
            board[r][c] = makeVinegar();
            soured = true;
            nigori += NIGORI_PENALTY;
          }
        }
      }
    }
    if (soured) toast(`あぁっ、お酢に…🫙 にごり -${NIGORI_PENALTY}`, 1);
  }

  // ---------- 素材の力（マッチしたグループの8近傍にある樽・お酢へ効果） ----------
  function applyIngredientEffects(groups) {
    let boosted = 0;
    let cooled = 0;
    let washed = 0;
    let soured = 0;

    for (const group of groups) {
      const first = group.cells[0];
      const tile = board[first.r][first.c];
      if (!tile || tile.kind !== "normal") continue;
      const typeId = TYPES[tile.type].id;
      const hasEffect =
        typeId === EFFECT_BOOST_TYPE ||
        typeId === EFFECT_COOL_TYPE ||
        typeId === EFFECT_WASH_TYPE;
      if (!hasEffect) continue;

      // グループ近傍のマスを重複なしで走査
      const seen = new Set();
      for (const p of group.cells) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const r = p.r + dr;
            const c = p.c + dc;
            if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
            const key = `${r},${c}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const t = board[r][c];
            if (!t) continue;
            if (t.kind === "barrel") {
              if (typeId === EFFECT_BOOST_TYPE) {
                t.gauge++;
                boosted++;
                if (t.gauge > GAUGE_MAX) {
                  board[r][c] = makeVinegar();
                  soured++;
                  nigori += NIGORI_PENALTY;
                }
              } else if (typeId === EFFECT_COOL_TYPE && t.gauge > 0) {
                t.gauge--;
                cooled++;
              }
            } else if (t.kind === "vinegar" && typeId === EFFECT_WASH_TYPE) {
              // 💧で洗い流し（タダでかたづけ）
              board[r][c] = null;
              washed++;
            }
          }
        }
      }
    }

    if (boosted) toast(`♨️ぽかぽか！はっこうがすすんだ（樽${boosted}つ）`, 1);
    if (cooled) toast(`🧊ひんやり、はっこうがゆっくりに（樽${cooled}つ）`, 1);
    if (washed) toast(`💧お酢をあらいながした！（樽${washed}つ）`, 2);
    if (soured) toast("♨️あっためすぎてお酢に…！🫙", 2);
  }

  // ---------- 連鎖解決（マッチ消去 → 樽生成 → 落下補充 → くりかえし） ----------
  async function resolveBoard(originCell) {
    let combo = 0;
    let groups = findMatches();

    let yardFullToasted = false;

    while (groups.length > 0) {
      combo++;
      showCombo(combo);

      // 消す前に「素材の力」を発動（盤面がそのままのうちに近傍判定）
      applyIngredientEffects(groups);

      const popClasses = {};
      let gained = 0;
      const barrelSpawns = [];
      let barrelsNow = countBarrels();

      for (const group of groups) {
        gained += group.cells.length * MATCH_POINT * combo;

        // 樽置き場（BARREL_CAP）に空きがあるときだけ、新しい樽がうまれる
        if (barrelsNow + barrelSpawns.length < BARREL_CAP) {
          // 樽の発生位置：入れかえ先がグループに含まれればそこ、なければ真ん中
          let spawnAt = group.cells[Math.floor(group.cells.length / 2)];
          if (
            originCell &&
            group.cells.some((p) => p.r === originCell.r && p.c === originCell.c)
          ) {
            spawnAt = { r: originCell.r, c: originCell.c };
          }
          // 4つ消しででか樽（×2）、5つ消しで金樽（×3）
          const mult =
            group.len >= 5 ? BARREL_MULT_PENTA : group.len >= 4 ? BARREL_MULT_QUAD : 1;
          barrelSpawns.push({ ...spawnAt, mult });
        } else if (!yardFullToasted) {
          yardFullToasted = true;
          toast("樽置き場がいっぱい！そろえたぶんは得点に🌾", 2);
        }

        for (const p of group.cells) {
          popClasses[`${p.r},${p.c}`] = "pop";
        }
      }

      render(popClasses);
      await sleep(200);

      // 消去 → 樽配置
      for (const group of groups) {
        for (const p of group.cells) board[p.r][p.c] = null;
      }
      let bestMult = 1;
      for (const s of barrelSpawns) {
        board[s.r][s.c] = makeBarrel(0, s.mult);
        bestMult = Math.max(bestMult, s.mult);
      }
      if (bestMult >= BARREL_MULT_PENTA) {
        toast("✨金樽がうまれた！中身ぜんぶ3倍！", 1);
      } else if (bestMult >= BARREL_MULT_QUAD) {
        toast("でか樽がうまれた！中身2倍！", 1);
      }

      score += gained;
      toast(combo >= 2 ? `+${gained} れんぞく x${combo}！` : `+${gained}`);

      applyGravity();
      const dropClasses = refill();
      render(dropClasses);
      await sleep(200);

      originCell = null;   // 2連鎖目以降は基準点なし
      groups = findMatches();
    }
    showCombo(combo);
  }

  // ---------- 落下と補充 ----------
  function applyGravity() {
    for (let c = 0; c < SIZE; c++) {
      let write = SIZE - 1;
      for (let r = SIZE - 1; r >= 0; r--) {
        if (board[r][c] !== null) {
          board[write][c] = board[r][c];
          if (write !== r) board[r][c] = null;
          write--;
        }
      }
      for (let r = write; r >= 0; r--) board[r][c] = null;
    }
  }

  function refill() {
    const dropClasses = {};
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === null) {
          board[r][c] = makeTile(randType());
          dropClasses[`${r},${c}`] = "drop";
        }
      }
    }
    return dropClasses;
  }

  // ---------- 注文（目標スペック） ----------
  function drawOrder() {
    order = ORDER_POOL[Math.floor(Math.random() * ORDER_POOL.length)];
  }

  function renderOrder() {
    const el = document.getElementById("orderLine");
    el.classList.remove("done");
    el.textContent = `📜 ご注文：${order.wish}（${order.hint}）`;
  }

  // ---------- 収穫（くっついた樽は「まとめてぽん！」で同時収穫） ----------
  function collectCluster(r, c) {
    const cluster = [];
    const seen = new Set();
    const stack = [{ r, c }];
    while (stack.length) {
      const p = stack.pop();
      const key = `${p.r},${p.c}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (p.r < 0 || p.r >= SIZE || p.c < 0 || p.c >= SIZE) continue;
      const t = board[p.r][p.c];
      if (!t || t.kind !== "barrel") continue;
      cluster.push(p);
      stack.push(
        { r: p.r + 1, c: p.c },
        { r: p.r - 1, c: p.c },
        { r: p.r, c: p.c + 1 },
        { r: p.r, c: p.c - 1 }
      );
    }
    return cluster;
  }

  async function harvestBarrel(r, c) {
    busy = true;
    const cluster = collectCluster(r, c);
    const n = cluster.length;
    const mult = n >= 3 ? GROUP_MULT_TRIO : n === 2 ? GROUP_MULT_PAIR : 1;
    const firstStage = stageOf(board[r][c]);

    // 収穫した樽ごとに、ステージに応じた軸へパラメータを注ぐ
    let kaoriGain = 0;
    let kokuGain = 0;
    for (const p of cluster) {
      const b = board[p.r][p.c];
      const stage = stageOf(b);
      const gain = stage.amount * (b.mult || 1);
      if (stage.axis === AXIS.KAORI) kaoriGain += gain;
      else kokuGain += gain;
      board[p.r][p.c] = null;
    }
    kaoriGain = Math.round(kaoriGain * mult);
    kokuGain = Math.round(kokuGain * mult);
    kaori += kaoriGain;
    koku += kokuGain;

    const parts = [];
    if (kaoriGain) parts.push(`かおり+${kaoriGain}`);
    if (kokuGain) parts.push(`こく+${kokuGain}`);
    const gainTxt = parts.join("・");
    if (n >= 2) {
      toast(`🍶 まとめてぽん！×${n}　${gainTxt}`);
    } else if (firstStage === STAGES.peak) {
      toast(`🍶 大吟醸！ ${gainTxt}`);
    } else if (firstStage === STAGES.ready) {
      toast(`🍶 純米酒！ ${gainTxt}`);
    } else {
      toast(`🍶 あまざけ… ${gainTxt}`);
    }

    applyGravity();
    const dropClasses = refill();
    render(dropClasses);
    await sleep(200);

    // 収穫後の落下で自然マッチが起きたら連鎖（おまけコンボ）
    await resolveBoard(null);
    await afterAction();
  }

  async function clearVinegar(r, c) {
    busy = true;
    // かたづけは1手ぶんの大しごと（💧をとなりで消せばタダで洗い流せる）
    moves--;
    flashMoves(-1);
    fermentAll();
    toast(`おそうじ（手数を1つかったよ）`);
    board[r][c] = null;
    applyGravity();
    const dropClasses = refill();
    render(dropClasses);
    await sleep(200);
    await resolveBoard(null);
    await afterAction();
  }

  // ---------- 手番おわりの共通処理 ----------
  async function afterAction() {
    // 詰みなら混ぜなおし
    if (!gameOver && moves > 0 && !hasValidMove()) {
      toast("うごかせる手がないから、混ぜなおすね！", 1);
      await sleep(500);
      shuffleNormals();
      render();
    }

    if (moves <= 0) {
      moves = 0;
      render();
      await sleep(400);
      await endGame();
    } else {
      render();
      busy = false;
    }
  }

  // 素材タイルだけをシャッフル（樽・お酢の位置は守る）
  function shuffleNormals() {
    const normals = [];
    for (const row of board) {
      for (const t of row) {
        if (t && t.kind === "normal") normals.push(t);
      }
    }
    for (let i = normals.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [normals[i], normals[j]] = [normals[j], normals[i]];
    }
    let k = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] && board[r][c].kind === "normal") {
          board[r][c] = normals[k++];
        }
      }
    }
    // 混ぜなおしで即マッチ・即詰みにならないよう保険
    let guard = 0;
    while ((findMatches().length > 0 || !hasValidMove()) && guard < 30) {
      guard++;
      for (const group of findMatches()) {
        const { r, c } = group.cells[0];
        board[r][c] = makeTile(randType());
      }
      if (!hasValidMove()) {
        // それでも詰みなら全とっかえ
        for (let r = 0; r < SIZE; r++) {
          for (let c = 0; c < SIZE; c++) {
            if (board[r][c] && board[r][c].kind === "normal") {
              board[r][c] = makeTile(randType());
            }
          }
        }
      }
    }
  }

  // ---------- 結果 ----------
  // 注文（目標スペック）への寄せ度を ◎○△ で評価
  function orderFit() {
    const b = brewResult();
    if (order.id === b.character) return { mark: "◎", word: "ご注文どおり！大満足！" };
    if (order.id === "balance" || b.character === "balance")
      return { mark: "○", word: "ご注文に近い仕上がり" };
    return { mark: "△", word: "ご注文とはちがうけど、これはこれで…" };
  }

  function pickName(character) {
    const pool = SAKE_NAMES[character];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  async function endGame() {
    gameOver = true;
    busy = true;

    // らすとしぼり：盤にのこった樽を、その時点のステージで全部しぼる
    let pressedKaori = 0;
    let pressedKoku = 0;
    let pressed = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const t = board[r][c];
        if (t && t.kind === "barrel") {
          const stage = stageOf(t);
          const gain = stage.amount * (t.mult || 1);
          if (stage.axis === AXIS.KAORI) pressedKaori += gain;
          else pressedKoku += gain;
          pressed++;
          board[r][c] = null;
        }
      }
    }
    if (pressed > 0) {
      kaori += pressedKaori;
      koku += pressedKoku;
      const p = [];
      if (pressedKaori) p.push(`かおり+${pressedKaori}`);
      if (pressedKoku) p.push(`こく+${pressedKoku}`);
      toast(`🍶 らすとしぼり！ 樽${pressed}個 ${p.join("・")}`);
      render();
      await sleep(1200);
    }

    const b = brewResult();
    const fit = orderFit();
    const name = pickName(b.character);
    const best = Number(localStorage.getItem(BEST_KEY) || 0);
    const isNewBest = b.total > best;
    if (isNewBest) localStorage.setItem(BEST_KEY, String(b.total));

    document.getElementById("resultScore").textContent = `${fit.mark}`;
    document.getElementById("resultRank").textContent = `${b.adj}${b.grade}『${name}』`;
    document.getElementById("resultOrders").textContent =
      `かおり ${kaori}／こく ${koku}${nigori ? `（にごり -${nigori}）` : ""} ｜ ${fit.word}`;
    document.getElementById("resultBest").textContent = isNewBest
      ? "✨ じぶん史上さいこうの一本！"
      : `じぶんベスト できばえ ${best}`;
    resultModal.classList.remove("hidden");
  }

  // ---------- ゲーム開始 ----------
  function startGame() {
    score = 0;
    kaori = 0;
    koku = 0;
    nigori = 0;
    moves = START_MOVES;
    selected = null;
    gameOver = false;
    busy = false;
    initBoard();
    if (!hasValidMove()) shuffleNormals();
    drawOrder();
    resultModal.classList.add("hidden");
    render();
    renderOrder();
  }

  // ---------- イベント ----------
  document.getElementById("helpBtn").addEventListener("click", () => {
    helpModal.classList.remove("hidden");
  });
  document.getElementById("helpCloseBtn").addEventListener("click", () => {
    helpModal.classList.add("hidden");
  });
  document.getElementById("restartBtn").addEventListener("click", startGame);
  document.getElementById("retryBtn").addEventListener("click", startGame);

  // 初回はあそびかたを表示してからスタート
  startGame();
  helpModal.classList.remove("hidden");

  // 動作検証用の最小フック（コンソールから盤面を確認・加工できる）
  window.__kamoshi = {
    getBoard: () => board,
    setTile: (r, c, t) => {
      board[r][c] = t;
      render();
    },
    makeTile,
    makeBarrel,
    makeVinegar,
    state: () => ({ kaori, koku, nigori, moves, busy, gameOver, order, brew: brewResult() }),
    setMoves: (n) => {
      moves = n;
      render();
    },
  };
})();
