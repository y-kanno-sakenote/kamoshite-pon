/* =========================================================
   かもしてぽん！くらまちモード（プロトタイプ）
   スバラシティ型：つながった同じタイルをタップで「まとめる」。
   値が合算されてそだつ：🌾(1)→🍚(3)→🫧(9)→🍶仕込み樽(27)。
   ためてから一気にまとめるほど、大きく育つ。
   発酵・収穫・お酢・注文は本編と同じ仕組みを使う。
   ========================================================= */

(() => {
  "use strict";

  // ---------- 定数定義 ----------
  const SIZE = 6;             // 盤面 6x6
  const START_ACTIONS = 40;   // 手かず（タップ行動の回数）
  const MERGE_POINT = 10;     // まとめ1タイルごとの基本点

  // 値のしきい値（お米換算）
  const BARREL_MIN = 18;   // 仕込み樽になる
  const BARREL_BIG = 27;   // でか樽（中身×2）
  const BARREL_GOLD = 36;  // 金樽（中身×3）

  const TIERS = [
    { id: "kome",   emoji: "🌾", name: "おこめ",   min: 1 },
    { id: "mushi",  emoji: "🍚", name: "むしまい", min: 3 },
    { id: "moromi", emoji: "🫧", name: "もろみ",   min: 9 },
  ];
  const TOOLS = {
    atsu:    { emoji: "♨️", name: "あっため", panel: "warm" },
    hiyashi: { emoji: "🧊", name: "ひやし", panel: "cold" },
    mizu:    { emoji: "💧", name: "お水" },
  };

  // 初期ボードの配合と補充率（%）
  const INITIAL_MIX = { kome: 24, atsu: 4, hiyashi: 4, mizu: 4 };
  const REFILL_WEIGHTS = [
    ["kome", 62],
    ["mushi", 8],
    ["atsu", 10],
    ["hiyashi", 10],
    ["mizu", 10],
  ];

  // 発酵まわり（本編と同じ）
  const GAUGE_MAX = 5;
  const STAGES = {
    young: { range: [0, 2], cls: "stage-young", harvestName: "あまざけ", point: 20 },
    ready: { range: [3, 4], cls: "stage-ready", harvestName: "純米酒",   point: 80 },
    peak:  { range: [5, 5], cls: "stage-peak",  harvestName: "大吟醸",   point: 250 },
  };
  const FERMENT_HEAVY_CHANCE = 0.35;
  const VINEGAR_POINT = 5;
  const BARREL_CAP = 4;
  const TOOL_STRONG_SIZE = 3; // 道具を3つ以上つなげると効果2倍
  const GROUP_MULT_PAIR = 1.5;
  const GROUP_MULT_TRIO = 2;

  // 蔵の注文書（本編と同じ）
  const ORDERS_PER_GAME = 3;
  const ORDER_POOL = [
    { product: "あまざけ", count: 2, reward: 120 },
    { product: "あまざけ", count: 3, reward: 220 },
    { product: "純米酒", count: 2, reward: 250 },
    { product: "純米酒", count: 3, reward: 420 },
    { product: "大吟醸", count: 1, reward: 350 },
    { product: "大吟醸", count: 2, reward: 750 },
  ];
  const ALL_ORDERS_BONUS = 300;

  const BEST_KEY = "kamoshitepon_kuramachi_best_v1";

  // ---------- 状態 ----------
  let board = [];
  let score = 0;
  let actions = START_ACTIONS;
  let busy = false;
  let gameOver = false;
  let orders = [];
  let orderIndex = 0;
  let barrelsMade = 0;

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

  // ---------- タイル生成 ----------
  const makeNormal = (value) => ({ kind: "normal", value });
  const makeTool = (tool) => ({ kind: "tool", tool });
  const makeBarrel = (gauge, mult = 1) => ({ kind: "barrel", gauge, mult });
  const makeVinegar = () => ({ kind: "vinegar" });

  function tierOf(value) {
    let tier = TIERS[0];
    for (const t of TIERS) {
      if (value >= t.min) tier = t;
    }
    return tier;
  }

  function stageOf(barrel) {
    if (barrel.gauge >= STAGES.peak.range[0]) return STAGES.peak;
    if (barrel.gauge >= STAGES.ready.range[0]) return STAGES.ready;
    return STAGES.young;
  }

  // 補充タイルの抽選（重みつき）
  function randRefillTile() {
    let roll = Math.random() * 100;
    for (const [id, w] of REFILL_WEIGHTS) {
      roll -= w;
      if (roll < 0) {
        if (id === "kome") return makeNormal(1);
        if (id === "mushi") return makeNormal(3);
        return makeTool(id);
      }
    }
    return makeNormal(1);
  }

  // ---------- 盤面初期化 ----------
  function initBoard() {
    const bag = [];
    for (const [id, n] of Object.entries(INITIAL_MIX)) {
      for (let i = 0; i < n; i++) {
        bag.push(id === "kome" ? makeNormal(1) : makeTool(id));
      }
    }
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    board = [];
    let k = 0;
    for (let r = 0; r < SIZE; r++) {
      board.push([]);
      for (let c = 0; c < SIZE; c++) board[r].push(bag[k++]);
    }
  }

  // ---------- つながり探索（タテヨコ連結） ----------
  function connected(r, c, sameFn) {
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
      if (!t || !sameFn(t)) continue;
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

  const sameTier = (tile) => (other) =>
    other.kind === "normal" && tierOf(other.value).id === tierOf(tile.value).id;
  const sameTool = (tile) => (other) =>
    other.kind === "tool" && other.tool === tile.tool;
  const isBarrel = () => (other) => other.kind === "barrel";

  // タップでいっしょにまとまる相手かどうか（つながり表示用）
  function sameLink(a, b) {
    if (!a || !b) return false;
    if (a.kind === "normal" && b.kind === "normal") {
      return tierOf(a.value).id === tierOf(b.value).id;
    }
    if (a.kind === "tool" && b.kind === "tool") return a.tool === b.tool;
    if (a.kind === "barrel" && b.kind === "barrel") return true;
    return false;
  }

  function countBarrels() {
    let n = 0;
    for (const row of board) {
      for (const t of row) if (t && t.kind === "barrel") n++;
    }
    return n;
  }

  // 板つなぎ用の隙間うめ（タイル種別とおなじ色で塗る）
  function fillColor(t) {
    if (t.kind === "tool") {
      const p = TOOLS[t.tool].panel;
      if (p === "warm") return "#fce7dc";
      if (p === "cold") return "#e2f3fb";
      return "#faf5e9";
    }
    if (t.kind === "barrel") return "#fff3dd";
    return "#faf5e9";
  }

  function addFill(cell, cls, t) {
    const f = document.createElement("span");
    f.className = `fill ${cls}`;
    f.style.background = fillColor(t);
    cell.appendChild(f);
  }

  // ---------- 打てる手があるか ----------
  function hasAnyAction() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const t = board[r][c];
        if (!t) continue;
        if (t.kind === "barrel") return true;
        const right = c + 1 < SIZE ? board[r][c + 1] : null;
        const down = r + 1 < SIZE ? board[r + 1][c] : null;
        if (t.kind === "normal") {
          if (right && sameTier(t)(right)) return true;
          if (down && sameTier(t)(down)) return true;
          if (
            tierOf(t.value).id === "moromi" &&
            t.value >= BARREL_MIN &&
            countBarrels() < BARREL_CAP
          ) {
            return true;
          }
        }
        if (t.kind === "tool") {
          if (right && sameTool(t)(right)) return true;
          if (down && sameTool(t)(down)) return true;
        }
      }
    }
    return false;
  }

  // ---------- 描画 ----------
  function render(extraClasses = {}) {
    // まとめてぽん予告：くっついている樽のかたまりサイズ
    const clusterSize = {};
    {
      const counted = new Set();
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const t = board[r][c];
          if (!t || t.kind !== "barrel" || counted.has(`${r},${c}`)) continue;
          const cluster = connected(r, c, isBarrel());
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
          const tier = tierOf(t.value);
          cell.textContent = tier.emoji;
          cell.title = `${tier.name}（お米${t.value}個ぶん）`;
          if (t.value > 1) {
            const vb = document.createElement("span");
            vb.className = "value-badge";
            vb.textContent = t.value;
            cell.appendChild(vb);
          }
        } else if (t.kind === "tool") {
          const def = TOOLS[t.tool];
          cell.textContent = def.emoji;
          cell.title = def.name;
          if (def.panel) cell.classList.add(`special-${def.panel}`);
        } else if (t.kind === "barrel") {
          const stage = stageOf(t);
          cell.classList.add("barrel", stage.cls);
          cell.textContent = "🍶";
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
          const size = clusterSize[`${r},${c}`] || 1;
          if (size >= 2) {
            const badge = document.createElement("span");
            badge.className = "cluster-badge";
            badge.textContent = `×${size}`;
            cell.appendChild(badge);
          }
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
          cell.title = "お酢になっちゃった…（💧で洗うしかない）";
        }

        // つながり表示：なかま同士は隙間を埋めて「一枚の板」に見せる
        if (t) {
          const right = c + 1 < SIZE ? board[r][c + 1] : null;
          const down = r + 1 < SIZE ? board[r + 1][c] : null;
          const left = c - 1 >= 0 ? board[r][c - 1] : null;
          const up = r - 1 >= 0 ? board[r - 1][c] : null;
          if (sameLink(t, right)) {
            cell.classList.add("fuse-r");
            addFill(cell, "fill-r", t);
          }
          if (sameLink(t, down)) {
            cell.classList.add("fuse-d");
            addFill(cell, "fill-d", t);
          }
          if (sameLink(t, left)) cell.classList.add("fuse-l");
          if (sameLink(t, up)) cell.classList.add("fuse-u");
          // 2x2でかたまっているときは角の小穴も埋める
          if (
            c + 1 < SIZE &&
            r + 1 < SIZE &&
            sameLink(t, right) &&
            sameLink(t, down) &&
            sameLink(t, board[r + 1][c + 1])
          ) {
            addFill(cell, "fill-c", t);
          }
        }

        const key = `${r},${c}`;
        if (extraClasses[key]) cell.classList.add(extraClasses[key]);
        cell.addEventListener("pointerdown", onCellTap);
        boardEl.appendChild(cell);
      }
    }
    scoreEl.textContent = score;
    movesEl.textContent = actions;
    comboEl.textContent = barrelsMade;
    updateStatusLine();
  }

  function updateStatusLine() {
    const best = Number(localStorage.getItem(BEST_KEY) || 0);
    statusEl.textContent = `樽 ${countBarrels()}/${BARREL_CAP} ｜ ベスト ${best}`;
  }

  // ---------- トースト・変身チップ ----------
  function toast(msg, offsetIndex = 0) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    el.style.top = `${36 + offsetIndex * 40}%`;
    toastLayer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  function spawnChip(r, c, text) {
    const cellEl = boardEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    if (!cellEl) return;
    const layerRect = toastLayer.getBoundingClientRect();
    const rect = cellEl.getBoundingClientRect();
    const chip = document.createElement("div");
    chip.className = "grow-chip";
    chip.textContent = text;
    chip.style.left = `${rect.left - layerRect.left + rect.width / 2}px`;
    chip.style.top = `${rect.top - layerRect.top - 8}px`;
    toastLayer.appendChild(chip);
    setTimeout(() => chip.remove(), 1000);
  }

  // ---------- 蔵の注文書（本編と同じ） ----------
  function drawOrders() {
    const pool = [...ORDER_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    orders = pool.slice(0, ORDERS_PER_GAME).map((o) => ({ ...o, progress: 0 }));
    orderIndex = 0;
  }

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

  // ---------- 発酵（1手ごと、きまぐれに+1か+2） ----------
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
          board[r][c] = randRefillTile();
          dropClasses[`${r},${c}`] = "drop";
        }
      }
    }
    return dropClasses;
  }

  // ---------- 入力 ----------
  function onCellTap(e) {
    if (busy || gameOver) return;
    const r = Number(e.currentTarget.dataset.r);
    const c = Number(e.currentTarget.dataset.c);
    const t = board[r][c];
    if (!t) return;

    if (t.kind === "barrel") {
      harvestBarrel(r, c);
    } else if (t.kind === "vinegar") {
      // お酢はタップでは消せない（💧で洗うしかない）
      toast("お酢は💧をつなげて洗わないと消えないよ…🫙");
    } else if (t.kind === "tool") {
      toolAction(r, c);
    } else {
      mergeAction(r, c);
    }
  }

  // ---------- まとめ（タップ合体） ----------
  async function mergeAction(r, c) {
    const tile = board[r][c];
    const group = connected(r, c, sameTier(tile));

    if (group.length < 2) {
      // 値27以上のもろみは、単独タップで樽になれる（置き場に空きがあれば）
      if (
        tierOf(tile.value).id === "moromi" &&
        tile.value >= BARREL_MIN &&
        countBarrels() < BARREL_CAP
      ) {
        await barrelize(r, c, tile.value);
        return;
      }
      toast("となりに同じなかまがいないよ");
      return;
    }

    busy = true;
    actions--;
    fermentAll();   // 先に発酵（このまとめで生まれる樽はまだ発酵しない）
    const oldTier = tierOf(tile.value);
    const total = group.reduce((s, p) => s + board[p.r][p.c].value, 0);
    const gained = group.length * MERGE_POINT;
    score += gained;

    // タップしたマス以外を消すアニメーション
    const popClasses = {};
    for (const p of group) {
      if (p.r !== r || p.c !== c) popClasses[`${p.r},${p.c}`] = "pop";
    }
    render(popClasses);
    await sleep(200);
    for (const p of group) {
      if (p.r !== r || p.c !== c) board[p.r][p.c] = null;
    }

    // タップしたマスに合体結果を置く
    if (total >= BARREL_MIN && countBarrels() < BARREL_CAP) {
      const mult = total >= BARREL_GOLD ? 3 : total >= BARREL_BIG ? 2 : 1;
      board[r][c] = makeBarrel(0, mult);
      barrelsMade++;
      render({ [`${r},${c}`]: "grow" });
      spawnChip(r, c, `${oldTier.emoji}→🍶 仕込み樽！`);
      if (mult >= 3) toast("✨金樽がうまれた！中身ぜんぶ3倍！", 1);
      else if (mult >= 2) toast("でか樽がうまれた！中身2倍！", 1);
      await sleep(500);
    } else {
      board[r][c] = makeNormal(total);
      const newTier = tierOf(total);
      render({ [`${r},${c}`]: "grow" });
      if (newTier.id !== oldTier.id) {
        spawnChip(r, c, `${oldTier.emoji}→${newTier.emoji} ${newTier.name}！`);
        await sleep(500);
      } else {
        await sleep(250);
      }
      if (total >= BARREL_MIN) {
        toast("樽置き場がいっぱい！あとで樽にしよう", 1);
      }
    }

    toast(`+${gained}`);
    applyGravity();
    const dropClasses = refill();
    render(dropClasses);
    await sleep(200);
    await afterAction();
  }

  // 値27以上のもろみを単独で樽にする
  async function barrelize(r, c, value) {
    busy = true;
    actions--;
    fermentAll();   // 先に発酵（この樽はまだ発酵しない）
    const mult = value >= BARREL_GOLD ? 3 : value >= BARREL_BIG ? 2 : 1;
    board[r][c] = makeBarrel(0, mult);
    barrelsMade++;
    render({ [`${r},${c}`]: "grow" });
    spawnChip(r, c, `🫧→🍶 仕込み樽！`);
    if (mult >= 3) toast("✨金樽がうまれた！中身ぜんぶ3倍！", 1);
    else if (mult >= 2) toast("でか樽がうまれた！中身2倍！", 1);
    await sleep(500);
    render();
    await afterAction();
  }

  // ---------- 道具（♨️🧊💧のペア以上をタップで、盤面ぜんぶに発動） ----------
  async function toolAction(r, c) {
    const tile = board[r][c];
    const group = connected(r, c, sameTool(tile));
    if (group.length < 2) {
      toast("おなじ道具を2つ以上つなげてタップしてね");
      return;
    }

    busy = true;
    actions--;
    fermentAll();   // 先に発酵 → そのうえで道具の効果（🧊で戻した分が即無効にならない）
    score += group.length * MERGE_POINT;

    // 効果は位置フリーで盤面ぜんぶに。3つ以上つなげると2倍
    const power = group.length >= TOOL_STRONG_SIZE ? 2 : 1;
    let boosted = 0;
    let cooled = 0;
    let washed = 0;
    let soured = 0;
    for (let rr = 0; rr < SIZE; rr++) {
      for (let cc = 0; cc < SIZE; cc++) {
        const t = board[rr][cc];
        if (!t) continue;
        if (t.kind === "barrel") {
          if (tile.tool === "atsu") {
            t.gauge += power;
            boosted++;
            if (t.gauge > GAUGE_MAX) {
              board[rr][cc] = makeVinegar();
              soured++;
            }
          } else if (tile.tool === "hiyashi" && t.gauge > 0) {
            t.gauge = Math.max(0, t.gauge - power);
            cooled++;
          }
        } else if (t.kind === "vinegar" && tile.tool === "mizu") {
          board[rr][cc] = null;
          score += VINEGAR_POINT;
          washed++;
        }
      }
    }
    if (boosted) toast(`♨️ぽかぽか！樽ぜんぶ +${power} すすんだ`, 1);
    if (cooled) toast(`🧊ひんやり！樽ぜんぶ −${power} もどった`, 1);
    if (washed) toast(`💧お酢をぜんぶ洗い流した！ +${VINEGAR_POINT * washed}`, 2);
    if (soured) toast("♨️あっためすぎてお酢に…！🫙", 2);
    if (tile.tool === "mizu" && !washed) toast("💧おそうじ完了（お酢はなかった）", 1);

    const popClasses = {};
    for (const p of group) popClasses[`${p.r},${p.c}`] = "pop";
    render(popClasses);
    await sleep(200);
    for (const p of group) board[p.r][p.c] = null;

    applyGravity();
    const dropClasses = refill();
    render(dropClasses);
    await sleep(200);
    await afterAction();
  }

  // ---------- 収穫（くっついた樽はまとめてぽん） ----------
  async function harvestBarrel(r, c) {
    busy = true;
    const cluster = connected(r, c, isBarrel());
    const n = cluster.length;
    const groupMult = n >= 3 ? GROUP_MULT_TRIO : n === 2 ? GROUP_MULT_PAIR : 1;
    const firstStage = stageOf(board[r][c]);

    let total = 0;
    for (const p of cluster) {
      const b = board[p.r][p.c];
      const stage = stageOf(b);
      total += stage.point * (b.mult || 1);
      recordHarvest(stage.harvestName);
      board[p.r][p.c] = null;
    }
    total = Math.round(total * groupMult);
    score += total;

    if (n >= 2) {
      toast(`🍶 まとめてぽん！×${n} +${total}`);
    } else if (firstStage === STAGES.peak) {
      toast(`🍶 大吟醸！ +${total}`);
    } else if (firstStage === STAGES.ready) {
      toast(`🍶 ${firstStage.harvestName}！ +${total}`);
    } else {
      toast(`🍶 まだ${firstStage.harvestName}… +${total}`);
    }

    applyGravity();
    const dropClasses = refill();
    render(dropClasses);
    await sleep(200);
    await afterAction();
  }

  // ---------- 手番おわりの共通処理 ----------
  async function afterAction() {
    if (actions <= 0) {
      actions = 0;
      render();
      await sleep(400);
      await endGame();
      return;
    }
    if (!hasAnyAction()) {
      toast("まとめる手がなくなった！しぼりおわり！", 1);
      render();
      await sleep(800);
      await endGame();
      return;
    }
    render();
    busy = false;
  }

  // ---------- 結果 ----------
  function rankOf(s) {
    if (s >= 6000) return "🏆 でんせつの杜氏！";
    if (s >= 4200) return "🍶 りっぱな杜氏！";
    if (s >= 2800) return "💪 ベテラン蔵人！";
    if (s >= 1400) return "😊 いっぱしの蔵人！";
    return "🌱 みならい蔵人！";
  }

  async function endGame() {
    gameOver = true;
    busy = true;

    // らすとしぼり：のこった樽を全部収穫
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
      `ご注文の納品 ${Math.min(orderIndex, orders.length)}/${orders.length}件 ｜ つくった樽 ${barrelsMade}個` +
      (pressed > 0 ? ` ｜ らすとしぼり 樽${pressed}個` : "");
    document.getElementById("resultBest").textContent = isNewBest
      ? "✨ ベストスコア更新！すごい！"
      : `ベスト ${best}`;
    resultModal.classList.remove("hidden");
  }

  // ---------- ゲーム開始 ----------
  function startGame() {
    score = 0;
    actions = START_ACTIONS;
    barrelsMade = 0;
    gameOver = false;
    busy = false;
    initBoard();
    drawOrders();
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

  startGame();
  helpModal.classList.remove("hidden");

  // 動作検証用の最小フック
  window.__kamoshi = {
    getBoard: () => board,
    setTile: (r, c, t) => {
      board[r][c] = t;
      render();
    },
    makeNormal,
    makeTool,
    makeBarrel,
    makeVinegar,
    state: () => ({ score, actions, busy, gameOver, orderIndex, orders, barrelsMade }),
    setActions: (n) => {
      actions = n;
      render();
    },
  };
})();
