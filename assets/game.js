/* =========================================================
   かもしてぽん！ 〜お酒づくりパズル〜
   素材を3つそろえると「仕込み樽」がうまれ、手数とともに発酵。
   のみごろを見きわめて収穫する、タイミング駆け引きパズル。
   依存ライブラリなし（Vanilla JS）／ベストスコアは localStorage に永続化
   ========================================================= */

(() => {
  "use strict";

  // ---------- 定数定義 ----------
  const SIZE = 6;            // 盤面 6x6
  const START_MOVES = 30;    // 持ち手数
  const MATCH_POINT = 10;    // 素材1つ消すごとの基本点

  // 素材タイル（やさしい名前で統一。♨️🧊は特殊パネル＝色つき）
  const TYPES = [
    { id: "kome",    emoji: "🌾", name: "お米" },
    { id: "mizu",    emoji: "💧", name: "お水" },
    { id: "bio",     emoji: "🦠", name: "びせいぶつ" },
    { id: "atsu",    emoji: "♨️", name: "あっため", panel: "warm" },
    { id: "hiyashi", emoji: "🧊", name: "ひやし", panel: "cold" },
  ];

  // 発酵ステージ定義（gauge は 0〜5、6でお酢になる）
  const GAUGE_MAX = 5;
  const STAGES = {
    young: { range: [0, 2], cls: "stage-young", harvestName: "あまざけ", point: 20 },
    ready: { range: [3, 4], cls: "stage-ready", harvestName: "純米酒",   point: 80 },
    peak:  { range: [5, 5], cls: "stage-peak",  harvestName: "大吟醸",   point: 250 },
  };
  const PEAK_BONUS_MOVES = 1;       // 大吟醸ごほうび：手数+1
  const PEAK_BONUS_STOCK = 5;       // ごほうびは1ゲームに5回まで（無限機関ふうじ）
  const FERMENT_HEAVY_CHANCE = 0.35; // 発酵が一気に+2すすむ「きまぐれ」の確率
  const VINEGAR_POINT = 5;          // お酢のかたづけ点

  // 素材の力（樽・お酢の8近傍でマッチしたときの効果）
  const EFFECT_BOOST_TYPE = "atsu";    // ♨️あっため：となりの樽の発酵+1
  const EFFECT_COOL_TYPE = "hiyashi";  // 🧊ひやし：となりの樽の発酵-1
  const EFFECT_WASH_TYPE = "mizu";     // 💧お水：となりのお酢を洗い流す

  // 蔵の注文書（1ゲームに3件、順番に納品していく）
  const ORDERS_PER_GAME = 3;
  const ORDER_POOL = [
    { product: "あまざけ", count: 2, reward: 120 },
    { product: "あまざけ", count: 3, reward: 220 },
    { product: "純米酒", count: 2, reward: 250 },
    { product: "純米酒", count: 3, reward: 420 },
    { product: "大吟醸", count: 1, reward: 350 },
    { product: "大吟醸", count: 2, reward: 750 },
  ];
  const ALL_ORDERS_BONUS = 300; // ぜんぶ納品ボーナス

  // 樽置き場（同時に持てる樽の数。少ないほど1樽が大事になる）
  const BARREL_CAP = 4;
  // 大物マッチのごほうび：4つ消し=でか樽（中身×2）、5つ消し=金樽（中身×3）
  const BARREL_MULT_QUAD = 2;
  const BARREL_MULT_PENTA = 3;
  // まとめてぽん！（くっついた樽の同時収穫倍率：2つ=×1.5、3つ以上=×2）
  const GROUP_MULT_PAIR = 1.5;
  const GROUP_MULT_TRIO = 2;

  const BEST_KEY = "kamoshitepon_best_v1";

  // ---------- 状態 ----------
  let board = [];        // board[row][col] = タイル or null
  let score = 0;
  let moves = START_MOVES;
  let peakBonuses = PEAK_BONUS_STOCK;
  let orders = [];       // 今ゲームの注文書（順番に納品）
  let orderIndex = 0;    // いま受けている注文の番号
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
          // ピーク樽の手数ごほうびは、タイル上の「+1」バッジが教える
          // （ごほうび在庫が尽きたらバッジも消える＝残数ルールの説明いらず）
          if (stage === STAGES.peak && peakBonuses > 0) {
            const mb = document.createElement("span");
            mb.className = "move-badge plus";
            mb.textContent = `+${PEAK_BONUS_MOVES}`;
            cell.appendChild(mb);
          }
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
          cell.title = "お酢になっちゃった…（タップでかたづけ、手数1）";
          // かたづけの手数コストも、タイル上の「−1」バッジが教える
          const mb = document.createElement("span");
          mb.className = "move-badge minus";
          mb.textContent = "−1";
          cell.appendChild(mb);
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
    scoreEl.textContent = score;
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

  function updateStatusLine() {
    const best = Number(localStorage.getItem(BEST_KEY) || 0);
    statusEl.textContent = `樽 ${countBarrels()}/${BARREL_CAP} ｜ ベスト ${best}`;
  }

  function showCombo(n) {
    comboEl.textContent = n >= 2 ? `x${n}！` : "-";
  }

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
          }
        }
      }
    }
    if (soured) toast("あぁっ、お酢になっちゃった…🫙", 1);
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
                }
              } else if (typeId === EFFECT_COOL_TYPE && t.gauge > 0) {
                t.gauge--;
                cooled++;
              }
            } else if (t.kind === "vinegar" && typeId === EFFECT_WASH_TYPE) {
              // 💧で洗い流し（タダでかたづけ＋ちょっと得点）
              board[r][c] = null;
              score += VINEGAR_POINT;
              washed++;
            }
          }
        }
      }
    }

    if (boosted) toast(`♨️ぽかぽか！はっこうがすすんだ（樽${boosted}つ）`, 1);
    if (cooled) toast(`🧊ひんやり、はっこうがゆっくりに（樽${cooled}つ）`, 1);
    if (washed) toast(`💧お酢をあらいながした！ +${VINEGAR_POINT * washed}`, 2);
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

  // ---------- 蔵の注文書 ----------
  function drawOrders() {
    const pool = [...ORDER_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    orders = pool.slice(0, ORDERS_PER_GAME).map((o) => ({ ...o, progress: 0 }));
    orderIndex = 0;
  }

  // 収穫物を今の注文と照合（納品できたら次の注文へ）
  function recordHarvest(productName) {
    const order = orders[orderIndex];
    if (!order || order.product !== productName) {
      renderOrder();
      return;
    }
    order.progress++;
    if (order.progress >= order.count) {
      score += order.reward;
      toast(`📜 ご注文納品！ +${order.reward}`, 2);
      orderIndex++;
      if (orderIndex >= orders.length) {
        score += ALL_ORDERS_BONUS;
        toast(`🎉 きょうのご注文ぜんぶ納品！ +${ALL_ORDERS_BONUS}`, 3);
      }
    }
    renderOrder();
  }

  function renderOrder() {
    const el = document.getElementById("orderLine");
    if (orderIndex >= orders.length) {
      el.textContent = "📜 きょうのご注文はぜんぶ納品ずみ！ありがとう✨";
      el.classList.add("done");
      return;
    }
    el.classList.remove("done");
    const o = orders[orderIndex];
    const rest = o.count - o.progress;
    el.textContent = `📜 ご注文（${orderIndex + 1}/${orders.length}件目）：${o.product} ×${o.count}（あと${rest}）→ ごほうび +${o.reward}`;
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

    let total = 0;
    let bonusMoves = 0;
    for (const p of cluster) {
      const b = board[p.r][p.c];
      const stage = stageOf(b);
      total += stage.point * (b.mult || 1);
      if (stage === STAGES.peak && peakBonuses > 0) {
        peakBonuses--;
        moves += PEAK_BONUS_MOVES;
        bonusMoves += PEAK_BONUS_MOVES;
      }
      recordHarvest(stage.harvestName);
      board[p.r][p.c] = null;
    }
    total = Math.round(total * mult);
    score += total;
    flashMoves(bonusMoves);

    if (n >= 2) {
      toast(`🍶 まとめてぽん！×${n} +${total}${bonusMoves ? `　手数+${bonusMoves}` : ""}`);
    } else if (firstStage === STAGES.peak) {
      toast(bonusMoves ? `🍶 大吟醸！ +${total}　手数+${bonusMoves}` : `🍶 大吟醸！ +${total}`);
    } else if (firstStage === STAGES.ready) {
      toast(`🍶 ${firstStage.harvestName}！ +${total}`);
    } else {
      toast(`🍶 まだ${firstStage.harvestName}… +${total}`);
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
    score += VINEGAR_POINT;
    toast(`おそうじ +${VINEGAR_POINT}　（手数を1つかったよ）`);
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
  function rankOf(s) {
    if (s >= 8000) return "🏆 でんせつの杜氏！";
    if (s >= 6000) return "🍶 りっぱな杜氏！";
    if (s >= 4000) return "💪 ベテラン蔵人！";
    if (s >= 2000) return "😊 いっぱしの蔵人！";
    return "🌱 みならい蔵人！";
  }

  async function endGame() {
    gameOver = true;
    busy = true;

    // らすとしぼり：盤にのこった樽を、その時点のステージで全部収穫
    let pressed = 0;
    let pressedPts = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const t = board[r][c];
        if (t && t.kind === "barrel") {
          const stage = stageOf(t);
          pressedPts += stage.point * (t.mult || 1);
          pressed++;
          recordHarvest(stage.harvestName);
          board[r][c] = null;
        }
      }
    }
    if (pressed > 0) {
      score += pressedPts;
      toast(`🍶 らすとしぼり！ 樽${pressed}個 +${pressedPts}`);
      render();
      await sleep(1200);
    }

    const best = Number(localStorage.getItem(BEST_KEY) || 0);
    const isNewBest = score > best;
    if (isNewBest) localStorage.setItem(BEST_KEY, String(score));

    document.getElementById("resultScore").textContent = score;
    document.getElementById("resultRank").textContent = rankOf(score);
    document.getElementById("resultOrders").textContent =
      `ご注文の納品 ${Math.min(orderIndex, orders.length)}/${orders.length}件` +
      (pressed > 0 ? ` ｜ らすとしぼり 樽${pressed}個` : "");
    document.getElementById("resultBest").textContent = isNewBest
      ? "✨ ベストスコア更新！すごい！"
      : `ベスト ${best}`;
    resultModal.classList.remove("hidden");
  }

  // ---------- ゲーム開始 ----------
  function startGame() {
    score = 0;
    moves = START_MOVES;
    peakBonuses = PEAK_BONUS_STOCK;
    selected = null;
    gameOver = false;
    busy = false;
    initBoard();
    if (!hasValidMove()) shuffleNormals();
    drawOrders();
    showCombo(0);
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
    state: () => ({ score, moves, busy, gameOver, peakBonuses, orderIndex, orders }),
    setMoves: (n) => {
      moves = n;
      render();
    },
  };
})();
