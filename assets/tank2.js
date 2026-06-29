/* =========================================================
   かもしてぽん！タンクモード（マッチ3×蔵が育つ×全国制覇）
   素材を3つそろえると、その軸のうまみパネルが底に溜まる：
     🌾米・🦠酵母 → 🍵こく ／ 💧水・🍚麹 → 🌸かおり
   パネルはタップで同じ数字どうし「まとめる」。発酵ピークで「しぼる」。
   一本ごとに その県の蔵の格が上がり、伝説の蔵まで育てたら県を制覇。
   地図から好きな県を選んで、全47県の全国統一をめざす。
   進捗（県ごとの蔵の格・現在地）は localStorage に永続。
   依存ライブラリなし（Vanilla JS）
   ========================================================= */

(() => {
  "use strict";

  const COLS = 6;
  let ROWS = 6;
  const AXIS = { KAORI: "kaori", KOKU: "koku" };

  const TYPES = [
    { id: "kome",  emoji: "🌾", name: "米",   axis: AXIS.KOKU },
    { id: "kobo",  emoji: "🦠", name: "酵母", axis: AXIS.KOKU },
    { id: "mizu",  emoji: "💧", name: "水",   axis: AXIS.KAORI },
    { id: "koji",  emoji: "🍚", name: "麹",   axis: AXIS.KAORI },
  ];
  const AXIS_DEF = {
    kaori: { emoji: "🌸", name: "かおり", cls: "panel-kaori" },
    koku:  { emoji: "🍵", name: "こく",   cls: "panel-koku" },
  };
  const TYPE_INDEX = Object.fromEntries(TYPES.map((t, i) => [t.id, i]));
  const MOTO_REFILL_CHANCE = 0.06; // 補充で酛（もと）が降ってくる確率（盤面に1つまで）

  const FERMENT_PER_MOVE = 3;
  const NIGORI_PER_OVERRIPE = 2;
  const KAIIRE_CHARGES = 2; // 櫂入れ（よこ一列さらい）の回数／1仕込み
  const FERMENT_SKIP_MAX = 2; // まとめのごほうび（発酵ひと休み）の貯金上限。溜めても凍結はできない

  const STAGES = [
    { min: 0,   name: "あまざけ", mult: 0.6 },
    { min: 40,  name: "のみごろ", mult: 1.0 },
    { min: 60,  name: "ピーク",   mult: 1.6 },
    { min: 90,  name: "過じゅく", mult: 1.0 },
    { min: 100, name: "お酢…",   mult: 0.4 },
  ];
  const PEAK_LO = 60, PEAK_HI = 90;

  const GRADE_TIERS = [
    { min: 0, name: "普通酒" }, { min: 18, name: "純米酒" }, { min: 36, name: "吟醸" }, { min: 64, name: "大吟醸" },
  ];
  // 熟成ボーナス：パネルを2枚ずつ「倍々」でまとめて大きく育てると、しぼり時の質が上がる
  // （盤面に残る大きいパネルの到達ティアぶん、出来の合計に加点）
  const JUKUSEI_TIERS = [
    { min: 32, bonus: 30, name: "極上の熟成" },
    { min: 16, bonus: 15, name: "よく熟成" },
    { min: 8,  bonus: 6,  name: "熟成のきざし" },
  ];
  // スコアリング（積み上げ点 × タイミング倍率 × 注文倍率）
  // 積み上げ点はゲーム中に増え、しぼった瞬間に倍率が掛かって確定する
  const SCORE_MATCH_PER_CELL = 2;   // マッチ：1セルあたりの基礎点（コンボ番号も掛かる）
  const SCORE_MERGE_PER_VALUE = 1;  // パネルまとめ：倍になった値 × これ
  const TIMING_MULTS = [
    { lo: 68, hi: 82, m: 2.0 },          // ど真ん中ピーク
    { lo: PEAK_LO, hi: PEAK_HI, m: 1.4 }, // ピーク帯
    { lo: 40, hi: 100, m: 0.8 },          // のみごろ〜過じゅく
  ];
  const TIMING_MULT_MIN = 0.4;           // あまざけ・お酢
  const SCORE_ORDER_MULT = { "◎": 1.5, "○": 1.0, "△": 0.5 };
  // B：テーマ色（盤面の地＝その土地の水の色）
  const THEME_COLORS = {
    snow: "#eef3f8", sea: "#e3f0f7", mountain: "#eef4e6",
    city: "#ededed", south: "#fdeecf", field: "#f5efe1", blossom: "#fbeaf0",
  };
  // 熟練カーブ：◎を出すのに必要な「理想への寄り具合」（蔵の格ランク別。上がるほど厳しい）
  // 評価＝「香りとこくの絶対量の差（ネット偏り）」で見る。蔵の格が上がるほど厳しい＝熟練カーブ。
  const GAUGE_SCALE = 30;                 // ネット差この値で ゲージ ±100（表示スケール）
  const MARU_DIFF = [8, 10, 13, 16, 20];  // kaori/koku：◎に必要なネット偏り量（格で厳しく）
  const BAL_DIFF  = [10, 8, 7, 6, 5];     // balance：このネット差以内なら◎（格で狭く）
  const OK_MARGIN_DIFF = 5;               // この差ぶん手前なら○

  const CELLAR_KEY = "kamoshitepon_tank2_cellar_v1";
  const CELLAR_MAX = 60;

  const RANKS = [
    { min: 0,    name: "みならい蔵" },
    { min: 300,  name: "蔵人の蔵" },
    { min: 900,  name: "銘酒蔵" },
    { min: 1800, name: "名門蔵" },
    { min: 3000, name: "伝説の蔵" },
  ];
  const ROWS_BY_RANK = [6, 6, 7, 7, 8];
  const KURA_EMOJI = ["🛖", "🏚️", "🏠", "🏯", "🏯"];
  const CONQUER_AT = RANKS[RANKS.length - 1].min; // 伝説の蔵＝制覇
  const REACTIONS = {
    "◎": "これこれ！こういうのが飲みたかった！", "○": "うん、なかなかいけるね。", "△": "ふむ、これはこれで乙なもんだ。",
  };

  // 全国10地方（ステージ）。順番自由・地図から選ぶ
  // n=地方名, aim=目指す味, style=味の一言, theme=地の色, names=ご当地銘柄（架空・商標回避）
  const PREFECTURES = [
    { n: "北海道", aim: "balance", style: "大地の旨み", theme: "snow",    names: ["大地", "流氷"] },
    { n: "東北",   aim: "kaori",   style: "雪国の吟醸", theme: "snow",    names: ["雪あかり", "みちのく"] },
    { n: "関東",   aim: "koku",    style: "下総の濃口", theme: "sea",     names: ["江戸前", "野田路"] },
    { n: "甲信",   aim: "kaori",   style: "ぶどうと果実", theme: "blossom", names: ["甲州路", "信濃路"] },
    { n: "北陸",   aim: "balance", style: "淡麗辛口",   theme: "snow",    names: ["越路", "白山"] },
    { n: "東海",   aim: "koku",    style: "八丁の濃醇", theme: "city",    names: ["尾張", "三河"] },
    { n: "近畿",   aim: "koku",    style: "灘の男酒",   theme: "field",   names: ["灘", "伏見"] },
    { n: "中国",   aim: "kaori",   style: "瀬戸内の吟醸", theme: "sea",    names: ["安芸", "錦帯"] },
    { n: "四国",   aim: "balance", style: "土佐のキレ", theme: "sea",     names: ["土佐", "讃岐"] },
    { n: "九州",   aim: "koku",    style: "薩摩の豪快", theme: "south",   names: ["薩摩", "火の国"] },
  ];
  const prefName = (i) => PREFECTURES[i].n;
  // 地図の並び（日本地図っぽく：北海道／東北・関東・甲信／北陸・東海・近畿／中国・四国・九州）
  const MAP_ROWS = [[0], [1, 2, 3], [4, 5, 6], [7, 8, 9]];

  // 進捗：県ごとの蔵の格＋現在いる県（localStorage）
  const PROGRESS_KEY = "kamoshitepon_tank2_progress_v1";
  function loadProgress() {
    try {
      const p = JSON.parse(localStorage.getItem(PROGRESS_KEY));
      if (p && typeof p === "object") return { current: p.current || 0, prestige: p.prestige || {} };
    } catch (e) {}
    return { current: 0, prestige: {} };
  }
  function saveProgress() { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); }
  let progress = loadProgress();
  const curIdx = () => progress.current;
  const prestigeOf = (idx) => progress.prestige[idx] || 0;
  const loadPrestige = () => prestigeOf(progress.current);
  const isConquered = (idx) => prestigeOf(idx) >= CONQUER_AT;
  const conqueredCount = () => { let n = 0; for (let i = 0; i < PREFECTURES.length; i++) if (isConquered(i)) n++; return n; };
  function getRankIdx(p) { let i = 0; for (let k = 0; k < RANKS.length; k++) if (p >= RANKS[k].min) i = k; return i; }

  // ---------- 状態 ----------
  let board = [];
  let ferment = 0;
  let nigori = 0;
  let fermentSkip = 0; // まとめのごほうび：次の発酵+3を何手ぶんスキップするか（バーは後退しない）
  let sessionScore = 0; // 今回の仕込みで積み上げた点（しぼり時に倍率が掛かって確定）
  let order = null;
  let selected = null;
  let busy = false;
  let gameOver = false;
  let kaiireLeft = KAIIRE_CHARGES;  // 残り櫂入れ回数
  let kaiireMode = false;           // 櫂入れの列えらび中か

  // ---------- DOM ----------
  const boardEl = document.getElementById("board");
  const statusSake = document.getElementById("statusSake");
  const statusFit  = document.getElementById("statusFit");
  const toastLayer = document.getElementById("toastLayer");
  const shiboruBtn = document.getElementById("shiboruBtn");
  const shiboruFill = document.getElementById("shiboruFill");
  const shiboruLabel = document.getElementById("shiboruLabel");
  const kaiireBtn = document.getElementById("kaiireBtn");
  const infoPref     = document.getElementById("infoPref");
  const infoRank     = document.getElementById("infoRank");
  const infoAimMain  = document.getElementById("infoAimMain");
  const infoAimSub   = document.getElementById("infoAimSub");
  const helpModal = document.getElementById("helpModal");
  const resultModal = document.getElementById("resultModal");
  const mapModal = document.getElementById("mapModal");
  // シーソーゲージ（香り−こくの偏りを見る）
  const gaugeZone = document.getElementById("gaugeZone");
  const gaugeZone2 = document.getElementById("gaugeZone2");
  const gaugeFill = document.getElementById("gaugeFill");
  const gaugeMarker = document.getElementById("gaugeMarker");
  const gaugeVal = document.getElementById("gaugeVal");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const randType = () => Math.floor(Math.random() * TYPES.length);
  const makeIng = (type) => ({ kind: "ing", type });
  const makePanel = (axis, value) => ({ kind: "panel", axis, value });
  const makeMoto = () => ({ kind: "moto" });

  // ---------- 盤面初期化 ----------
  function initBoard() {
    board = [];
    for (let r = 0; r < ROWS; r++) {
      board.push([]);
      for (let c = 0; c < COLS; c++) board[r].push(makeIng(randType()));
    }
    while (findMatches().length > 0) {
      for (const g of findMatches()) { const { r, c } = g.cells[0]; board[r][c] = makeIng(randType()); }
    }
  }

  function findMatches() {
    const groups = [];
    const scan = (cells) => {
      let run = [];
      const flush = () => { if (run.length >= 3) groups.push({ cells: [...run], type: board[run[0].r][run[0].c].type }); run = []; };
      let prev = null;
      for (const { r, c } of cells) {
        const t = board[r][c];
        const type = t && t.kind === "ing" ? t.type : null;
        if (type !== null && type === prev) run.push({ r, c });
        else { flush(); run = type !== null ? [{ r, c }] : []; }
        prev = type;
      }
      flush();
    };
    for (let r = 0; r < ROWS; r++) scan(Array.from({ length: COLS }, (_, c) => ({ r, c })));
    for (let c = 0; c < COLS; c++) scan(Array.from({ length: ROWS }, (_, r) => ({ r, c })));
    return groups;
  }

  function hasValidMove() {
    // 酛があればタップで動かせる＝手がある
    if (board.some((row) => row.some((t) => t && t.kind === "moto"))) return true;
    const sw = (r, c) => board[r][c] && board[r][c].kind === "ing";
    const t = (r1, c1, r2, c2) => {
      if (!sw(r1, c1) || !sw(r2, c2)) return false;
      const a = board[r1][c1], b = board[r2][c2];
      [board[r1][c1], board[r2][c2]] = [b, a];
      const ok = findMatches().length > 0;
      [board[r1][c1], board[r2][c2]] = [a, b];
      return ok;
    };
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && t(r, c, r, c + 1)) return true;
      if (r + 1 < ROWS && t(r, c, r + 1, c)) return true;
    }
    return false;
  }

  function boardSums() {
    let kaori = 0, koku = 0;
    for (const row of board) for (const t of row) if (t && t.kind === "panel") {
      if (t.axis === AXIS.KAORI) kaori += t.value; else koku += t.value;
    }
    return { kaori, koku };
  }

  // ---------- 描画 ----------
  function render(extraClasses = {}) {
    boardEl.style.gridTemplateColumns = `repeat(${COLS}, var(--tile-size))`;
    boardEl.style.gridTemplateRows = `repeat(${ROWS}, var(--tile-size))`;
    boardEl.innerHTML = "";
    // 選択中がパネルなら、隣接する「同じ軸・同じ数字」のパネルをまとめ候補としてハイライト
    const mergeTargets = {};
    if (selected) {
      const st = board[selected.r][selected.c];
      if (st && st.kind === "panel") {
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rr = selected.r + dr, cc = selected.c + dc;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
          const t2 = board[rr][cc];
          if (t2 && t2.kind === "panel" && t2.axis === st.axis && t2.value === st.value) mergeTargets[`${rr},${cc}`] = true;
        }
      }
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.r = r; cell.dataset.c = c;
      const t = board[r][c];
      if (t === null) cell.style.visibility = "hidden";
      else if (t.kind === "ing") {
        const def = TYPES[t.type];
        cell.textContent = def.emoji;
        cell.title = `${def.name}（${def.axis === AXIS.KAORI ? "かおり" : "こく"}のもと）`;
        cell.classList.add(def.axis === AXIS.KAORI ? "ingredient-kaori" : "ingredient-koku");
      } else if (t.kind === "panel") {
        const def = AXIS_DEF[t.axis];
        cell.textContent = def.emoji; cell.classList.add(def.cls);
        cell.classList.add("pv-" + Math.max(0, Math.min(6, Math.round(Math.log2(t.value))))); // 数字ごとに濃淡
        cell.title = `${def.name}パネル（${t.value}）`;
        const vb = document.createElement("span"); vb.className = "value-badge"; vb.textContent = t.value; cell.appendChild(vb);
      } else if (t.kind === "moto") {
        cell.classList.add("moto-cell");
        cell.textContent = "🫧";
        cell.title = "酛（もと）：タップでまわり8マスを今の注文の味に変える";
      }
      const key = `${r},${c}`;
      if (extraClasses[key]) cell.classList.add(extraClasses[key]);
      if (mergeTargets[key]) cell.classList.add("merge-target");
      if (selected && selected.r === r && selected.c === c) cell.classList.add("selected");
      cell.addEventListener("pointerdown", onCellDown);
      boardEl.appendChild(cell);
    }
    updateHud();
  }

  // ---------- シーソーゲージ：香り−こくの偏りを見る ----------
  // 盤面の かおり と こく の差（偏り）を -100〜+100 で表す。
  //   +100＝香り極振り／-100＝こく極振り／0＝つりあい。
  // ねらいゾーン（◎/○帯）は、いまの注文の軸と蔵の格（熟練カーブ）から導出する。
  // ＝ 評価 evalFit（ネット偏り量 × 蔵の格＝熟練カーブ）をそのまま見える化したもの。
  function tasteDiff(s) { return s.kaori - s.koku; } // 香り−こく（絶対量の差）
  const diffToGauge = (d) => Math.max(-100, Math.min(100, Math.round(d / GAUGE_SCALE * 100)));
  function gaugeZones(aimId, rankIdx) {
    const need = MARU_DIFF[rankIdx], mg = OK_MARGIN_DIFF, G = diffToGauge;
    if (aimId === "kaori") return { maru: [G(need), 100], maru2: [G(need - mg), 100] };
    if (aimId === "koku")  return { maru: [-100, G(-need)], maru2: [-100, G(-(need - mg))] };
    const bal = BAL_DIFF[rankIdx];
    return { maru: [G(-bal), G(bal)], maru2: [G(-(bal + mg)), G(bal + mg)] }; // balance＝中央帯
  }
  function updateGauge(s) {
    if (!gaugeMarker) return;
    const total = s.kaori + s.koku;
    const gv = diffToGauge(tasteDiff(s));
    const aimId = order ? order.id : PREFECTURES[curIdx()].aim;
    const z = gaugeZones(aimId, getRankIdx(loadPrestige()));
    const pct = (v) => (v + 100) / 2; // -100→0% / +100→100%
    gaugeZone2.style.bottom = `${pct(z.maru2[0])}%`;
    gaugeZone2.style.height = `${pct(z.maru2[1]) - pct(z.maru2[0])}%`;
    gaugeZone.style.bottom = `${pct(z.maru[0])}%`;
    gaugeZone.style.height = `${pct(z.maru[1]) - pct(z.maru[0])}%`;
    const center = pct(0), now = pct(gv);
    gaugeFill.style.bottom = `${Math.min(center, now)}%`;
    gaugeFill.style.height = `${Math.abs(now - center)}%`;
    gaugeFill.classList.toggle("to-kaori", gv >= 0);
    gaugeFill.classList.toggle("to-koku", gv < 0);
    gaugeMarker.style.bottom = `${now}%`;
    // 評価色は評価ロジックと一致させる。パネルが無い（total=0）うちは中立（灰）。
    const inMaru = total > 0 && gv >= z.maru[0] && gv <= z.maru[1];
    const inMaru2 = total > 0 && gv >= z.maru2[0] && gv <= z.maru2[1];
    gaugeMarker.className = "gauge-marker" + (inMaru ? " maru" : inMaru2 ? " maru2" : "");
    gaugeVal.textContent = (gv > 0 ? "+" : "") + gv;
  }

  function updateHud() {
    const s = boardSums();
    updateGauge(s);
    const b = brewPreview();
    // 盤面の地＝その県のテーマ色（B）。バランスは数値で見えるので地の色はご当地色に
    boardEl.style.background = THEME_COLORS[PREFECTURES[curIdx()].theme] || "transparent";
    // 仕上がり予報：今しぼったらどんな酒で、注文に◎○△か＋どっちに寄せるか
    let fitMark = "△";
    if (order) {
      const rankIdx = getRankIdx(loadPrestige());
      const fit = evalFit(order.id, s.kaori, s.koku, rankIdx);
      fitMark = fit.mark;
      const nigoriTxt = nigori > 0 ? `（にごり -${nigori}）` : "";
      statusSake.textContent = `${b.adj}${b.grade}${nigoriTxt}`;
      const nudge = fitHint(order.id, s.kaori, s.koku, fit.mark);
      statusFit.textContent = `${fit.mark} ${nudge}`;
      statusFit.className = `status-fit ${fit.mark === "◎" ? "fit-maru2" : fit.mark === "○" ? "fit-maru" : "fit-sanka"}`;
    }
    // 予想スコア：今しぼったら何pt確定するか（タイミング倍率 × 注文倍率）
    const tm = timingMult(ferment);
    const om = SCORE_ORDER_MULT[fitMark];
    const projected = Math.round((sessionScore + b.juku.bonus) * tm * om);
    // しぼるボタン＝発酵バー：満ち具合（width）と色・言葉で進捗を伝える
    shiboruFill.style.width = `${Math.min(100, ferment)}%`;
    let fillCls, label;
    if (ferment >= PEAK_HI) { fillCls = "s-over"; label = "🍶 はやくしぼって！"; }
    else if (ferment >= PEAK_LO) { fillCls = "s-peak"; label = "🍶 いまだ！しぼる"; }
    else if (ferment >= 40) { fillCls = "s-ready"; label = "🍶 しぼる"; }
    else { fillCls = "s-young"; label = "🍶 しぼる（まだあまい）"; }
    shiboruFill.className = `shiboru-fill ${fillCls}`;
    const skipTxt = fermentSkip > 0 ? `　⏸️×${fermentSkip}` : "";
    const peakMovesLeft = (ferment >= PEAK_LO && ferment < PEAK_HI)
      ? Math.max(1, Math.floor((PEAK_HI - ferment) / FERMENT_PER_MOVE)) : 0;
    const peakTxt = peakMovesLeft > 0 ? `　あと${peakMovesLeft}手` : "";
    shiboruLabel.textContent = `${label}${peakTxt}${skipTxt}　→ ${projected}pt`;
    shiboruBtn.classList.toggle("peak-now", ferment >= PEAK_LO && ferment < PEAK_HI);
  }

  // ---------- 出来 ----------
  function stageOf(f) { let s = STAGES[0]; for (const st of STAGES) if (f >= st.min) s = st; return s; }
  function gradeOf(total) { let g = GRADE_TIERS[0].name; for (const t of GRADE_TIERS) if (total >= t.min) g = t.name; return g; }
  function characterOf(ka, ko) { if (ka > ko * 1.3) return "kaori"; if (ko > ka * 1.3) return "koku"; return "balance"; }
  function adjOf(ch) { return ch === "kaori" ? "華やかな" : ch === "koku" ? "ふくよかな" : "ととのった"; }
  // 盤面に残る大きいパネルの「熟成ボーナス」（到達ティアぶん加点）と最上ティア名
  function jukuseiBonus() {
    let bonus = 0, bestIdx = -1;
    for (const row of board) for (const t of row) {
      if (!t || t.kind !== "panel") continue;
      for (let i = 0; i < JUKUSEI_TIERS.length; i++) {
        if (t.value >= JUKUSEI_TIERS[i].min) { bonus += JUKUSEI_TIERS[i].bonus; if (bestIdx < 0 || i < bestIdx) bestIdx = i; break; }
      }
    }
    return { bonus, name: bestIdx >= 0 ? JUKUSEI_TIERS[bestIdx].name : null };
  }
  function brewPreview() {
    const s = boardSums(); const st = stageOf(ferment);
    const juku = jukuseiBonus();
    const total = Math.max(0, Math.round((s.kaori + s.koku) * st.mult) - nigori + juku.bonus);
    const ch = characterOf(s.kaori, s.koku);
    return { total, grade: gradeOf(total), character: ch, adj: adjOf(ch), juku };
  }
  // 仕上がり予報のひとこと（◎なら満足、それ以外はどっちに寄せるか）
  function fitHint(aimId, ka, ko, mark) {
    if (mark === "◎") return "ばっちり！";
    if (aimId === "kaori") return "💧🍚を揃えて";
    if (aimId === "koku")  return "🌾🦠を揃えて";
    return ka > ko ? "🌾🦠を揃えて" : "💧🍚を揃えて"; // balance：低い方を引き上げる
  }
  // タイミング倍率：発酵度がピーク中央（75前後）に近いほど高い
  function timingMult(f) {
    for (const { lo, hi, m } of TIMING_MULTS) if (f >= lo && f <= hi) return m;
    return TIMING_MULT_MIN;
  }
  function timingLabel(f) {
    if (f >= 68 && f <= 82) return "ど真ん中ピーク！";
    if (f >= PEAK_LO && f < PEAK_HI) return "ピークでしぼった！";
    if (f >= 40 && f < PEAK_HI) return "のみごろでしぼった";
    if (f >= PEAK_HI) return "過じゅくでしぼった…";
    return "まだあまかった…";
  }
  function orderLabel(mark) {
    if (mark === "◎") return "◎ ご注文ばっちり！";
    if (mark === "○") return "○ おしい！あと少し";
    return "△ 方向がちがった…";
  }
  // 評価：注文の軸への「ネット偏り量」× 蔵の格（熟練カーブ）で ◎○△。ゲージの帯と完全一致。
  function evalFit(aimId, ka, ko, rankIdx) {
    const diff = ka - ko, mg = OK_MARGIN_DIFF;
    if (aimId === "balance") {
      const bal = BAL_DIFF[rankIdx];
      if (Math.abs(diff) <= bal) return { mark: "◎", word: "ご注文どおり！大満足！" };
      if (Math.abs(diff) <= bal + mg) return { mark: "○", word: "おしい！あと一歩" };
      return { mark: "△", word: "今回は方向ちがい…これはこれで" };
    }
    const need = MARU_DIFF[rankIdx];
    const net = aimId === "kaori" ? diff : -diff; // 注文の軸へのネット偏り
    if (net >= need) return { mark: "◎", word: "ご注文どおり！大満足！" };
    if (net >= need - mg) return { mark: "○", word: "おしい！あと一歩" };
    return { mark: "△", word: "今回は方向ちがい…これはこれで" };
  }
  // B：ご当地銘柄から名前をつける
  function pickName(pref) { return pref.names[Math.floor(Math.random() * pref.names.length)]; }

  function toast(msg, offsetIndex = 0) {
    const el = document.createElement("div"); el.className = "toast"; el.textContent = msg;
    el.style.top = `${36 + offsetIndex * 40}%`; toastLayer.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  function drawOrder() {
    const pref = PREFECTURES[curIdx()];
    const rankIdx = getRankIdx(loadPrestige());
    // 基本はその県の理想。蔵が育つと、たまに旅人が別の味を求める（変化）
    const traveler = rankIdx >= 1 && Math.random() < 0.25;
    let id, who, wishCore;
    if (traveler) {
      const others = ["kaori", "koku", "balance"].filter((x) => x !== pref.aim);
      id = others[Math.floor(Math.random() * others.length)];
      who = "旅の人";
      wishCore = id === "kaori" ? "華やかな一本" : id === "koku" ? "ふくよかな一本" : "ととのった一本";
    } else {
      id = pref.aim;
      who = rankIdx >= 3 ? "品評会の審査員" : "地元のなじみ";
      wishCore = `${pref.n}らしい、${pref.style}な一本`;
    }
    const hint = id === "kaori" ? "💧水・🍚麹で香りを高く" : id === "koku" ? "🌾米・🦠酵母でこくを高く" : "香りとこくをバランスよく";
    const tip = traveler ? 90 : 50 + rankIdx * 20; // 蔵が有名になるほど看板酒に高値
    order = { id, who, wish: `${wishCore}がほしい`, hint, tip };
  }
  function aimText(aimId) {
    if (aimId === "kaori") return "🌸 香りを高く仕上げて";
    if (aimId === "koku")  return "🍵 こくを深く仕上げて";
    return "⚖️ 香りとこくをバランスよく";
  }
  function renderOrder() {
    infoAimMain.textContent = aimText(order.id);
    infoAimSub.textContent  = `${order.who}のオーダー`;
  }

  function advanceFerment() {
    // まとめのごほうびが溜まっていれば、この一手は発酵を進めない（バーは後退しない＝ひと休み）
    if (fermentSkip > 0) { fermentSkip--; toast("⏸️ 発酵はひと休み（まとめのごほうび）", 1); return; }
    const wasBelowPeak = ferment < PEAK_LO;
    ferment += FERMENT_PER_MOVE;
    if (ferment > 100) ferment = 100;
    if (ferment >= PEAK_HI) nigori += NIGORI_PER_OVERRIPE;
    // のみごろ → ピークに入った瞬間、しぼりどきを知らせる
    if (wasBelowPeak && ferment >= PEAK_LO && ferment < PEAK_HI) toast("🍶 ピーク！いまがしぼりどき！", 1);
  }

  // ---------- 落下（香り↑・素材中・こく↓） ----------
  function applyGravity() {
    for (let c = 0; c < COLS; c++) {
      const kaoriPanels = [], ingredients = [], kokuPanels = [];
      for (let r = 0; r < ROWS; r++) {
        const t = board[r][c];
        if (!t) continue;
        if (t.kind === "panel") { t.settled = true; if (t.axis === AXIS.KAORI) kaoriPanels.push(t); else kokuPanels.push(t); }
        else ingredients.push(t); // 素材・酛は中段で落ちる
      }
      const nulls = Array(ROWS - kaoriPanels.length - ingredients.length - kokuPanels.length).fill(null);
      const newCol = [...kaoriPanels, ...nulls, ...ingredients, ...kokuPanels];
      for (let r = 0; r < ROWS; r++) board[r][c] = newCol[r];
    }
  }
  // 連鎖中の落下：分離ずみ(settled)の端パネルはアンカー固定（落ちてこない）。
  // 中央の「素材＋まだ分離していない新パネル」だけを下に詰める（空きは上にできて素材が降る）。
  function collapseMiddle() {
    for (let c = 0; c < COLS; c++) {
      const topKaori = [], middle = [], botKoku = [];
      for (let r = 0; r < ROWS; r++) {
        const t = board[r][c];
        if (!t) continue;
        if (t.kind === "panel" && t.settled) {
          if (t.axis === AXIS.KAORI) topKaori.push(t); else botKoku.push(t);
        } else {
          middle.push(t); // 素材＋未分離パネル
        }
      }
      const nulls = Array(ROWS - topKaori.length - middle.length - botKoku.length).fill(null);
      const newCol = [...topKaori, ...nulls, ...middle, ...botKoku];
      for (let r = 0; r < ROWS; r++) board[r][c] = newCol[r];
    }
  }
  function refill() {
    const dropClasses = {};
    let hasMoto = board.some((row) => row.some((t) => t && t.kind === "moto"));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (board[r][c] === null) {
        if (!hasMoto && Math.random() < MOTO_REFILL_CHANCE) { board[r][c] = makeMoto(); hasMoto = true; }
        else board[r][c] = makeIng(randType());
        dropClasses[`${r},${c}`] = "drop";
      }
    return dropClasses;
  }

  // 隣接2マスのアクション：パネル同士（同じ軸・同じ数字）→まとめ／素材・酛どうし→入れかえ。成立で true
  function doAdjacentAction(a, b) {
    const ta = board[a.r][a.c], tb = board[b.r][b.c];
    if (!ta || !tb) return false;
    if (ta.kind === "panel" && tb.kind === "panel" && ta.axis === tb.axis && ta.value === tb.value) { mergePair(a, b); return true; }
    if (ta.kind !== "panel" && tb.kind !== "panel") { trySwap(a, b); return true; }
    return false; // かみ合わない組み合わせ
  }

  // ドラッグ／スワイプで隣へスッと動かすと、その瞬間に入れかえ／まとめ。
  // 動かさず離せばタップ（2タップで選んで合わせる方式も残す）。
  let dragStart = null, swipeFired = false;
  function tileSizePx() { const c0 = boardEl.querySelector(".cell"); return c0 ? c0.getBoundingClientRect().width : 50; }
  function onCellDown(e) {
    if (busy || gameOver) return;
    const r = Number(e.currentTarget.dataset.r), c = Number(e.currentTarget.dataset.c);
    if (kaiireMode) {
      const t = board[r][c];
      if (!t || t.kind !== "ing") { setKaiireMode(false); render(); return; }
      setKaiireMode(false); kaiireType(t.type); return;
    }
    if (!board[r][c]) return;
    dragStart = { r, c, x: e.clientX, y: e.clientY };
    swipeFired = false;
  }
  function onPointerMove(e) {
    if (!dragStart || swipeFired || busy || gameOver) return;
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < tileSizePx() * 0.4) return; // タイルの4割動いたらスワイプ確定
    swipeFired = true;
    const from = { r: dragStart.r, c: dragStart.c };
    const tr = from.r + (ax > ay ? 0 : (dy > 0 ? 1 : -1));
    const tc = from.c + (ax > ay ? (dx > 0 ? 1 : -1) : 0);
    dragStart = null; selected = null;
    if (tr >= 0 && tr < ROWS && tc >= 0 && tc < COLS && board[tr][tc]) doAdjacentAction(from, { r: tr, c: tc });
    else render();
  }
  function onPointerUp() {
    if (!dragStart) return;
    const { r, c } = dragStart; dragStart = null;
    if (swipeFired || busy || gameOver) return;
    if (selected === null) { selected = { r, c }; render(); return; }
    const same = selected.r === r && selected.c === c;
    const adj = Math.abs(selected.r - r) + Math.abs(selected.c - c) === 1;
    if (same) { selected = null; render(); return; }
    if (adj) {
      const from = selected; selected = null;
      if (!doAdjacentAction(from, { r, c })) { selected = { r, c }; render(); }
      return;
    }
    selected = { r, c }; render();
  }

  async function trySwap(a, b) {
    const ta = board[a.r][a.c], tb = board[b.r][b.c];
    // 酛＋素材 → 入れ替え→3×3が消滅→中央にその軸のパネルが1枚生まれる（値はまわりのパネル数＋自分で決まる）
    if (ta.kind === "moto" || tb.kind === "moto") {
      const motoPos = ta.kind === "moto" ? a : b;
      const ingPos = ta.kind === "moto" ? b : a;
      const ingTile = ta.kind === "moto" ? tb : ta;
      if (ingTile.kind !== "ing") { selected = null; render(); return; }
      await motoConvert(motoPos, ingPos, ingTile.type);
      return;
    }
    if (ta.kind !== "ing" || tb.kind !== "ing") { selected = null; render(); return; }
    busy = true;
    [board[a.r][a.c], board[b.r][b.c]] = [tb, ta];
    render(); await sleep(120);
    if (findMatches().length === 0) {
      [board[a.r][a.c], board[b.r][b.c]] = [ta, tb]; render(); busy = false; return;
    }
    advanceFerment();
    await resolveBoard(b);
    await afterAction();
  }

  // ① 連鎖フェーズ：その場でパネル生成→中央だけ詰める(collapseMiddle・端の分離ずみは固定)→連鎖、を繰り返す
  async function runCascades(originCell) {
    let combo = 0;
    let groups = findMatches();
    while (groups.length > 0) {
      combo++;
      const popClasses = {}; const spawns = [];
      for (const g of groups) {
        const axis = TYPES[g.type].axis;
        const value = Math.pow(2, Math.min(g.cells.length, 5) - 3);
        let at = g.cells[Math.floor(g.cells.length / 2)];
        if (originCell && g.cells.some((p) => p.r === originCell.r && p.c === originCell.c)) at = originCell;
        spawns.push({ ...at, axis, value });
        for (const p of g.cells) popClasses[`${p.r},${p.c}`] = "pop";
      }
      render(popClasses); await sleep(190);
      for (const g of groups) for (const p of g.cells) board[p.r][p.c] = null;
      // その場でパネル生成（軸分離はまだしない）
      for (const s of spawns) { const p = makePanel(s.axis, s.value); p.fresh = true; board[s.r][s.c] = p; }
      const matchPts = groups.reduce((sum, g) => sum + g.cells.length * SCORE_MATCH_PER_CELL * combo, 0);
      sessionScore += matchPts;
      const def = spawns.length ? AXIS_DEF[spawns[0].axis] : null;
      if (def) toast(combo >= 2 ? `れんぞく x${combo}！うまみパネル！ +${matchPts}pt` : `${def.emoji}${def.name}パネルが生まれた！ +${matchPts}pt`);
      collapseMiddle();
      // 生成パネルの「生まれた」演出を、落下後の位置に付ける
      const growClasses = {};
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const t = board[r][c];
        if (t && t.kind === "panel" && t.fresh) { growClasses[`${r},${c}`] = "grow"; delete t.fresh; }
      }
      render(Object.assign(growClasses, refill())); await sleep(230);
      originCell = null;
      groups = findMatches();
    }
  }
  // 連鎖が落ち着いたら → 香りは上・こくは下へ分離（立ちのぼり/沈み演出）。
  // 分離で新しいマッチが出たら、また連鎖を回す（前者方式）。
  async function resolveBoard(originCell) {
    let guard = 0;
    do {
      await runCascades(originCell);
      originCell = null;
      // 分離演出は「まだ分離していない新しいパネル」だけ。既存の端パネルはぽよんとさせない。
      for (const row of board) for (const t of row) if (t && t.kind === "panel" && !t.settled) t.fresh = true;
      applyGravity(); // ＝軸分離（香り上・素材中・こく下）。ここで全パネルが settled になる。
      const anim = {};
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const t = board[r][c];
        if (t && t.kind === "panel" && t.fresh) { anim[`${r},${c}`] = t.axis === AXIS.KAORI ? "rise-kaori" : "sink-koku"; delete t.fresh; }
      }
      render(Object.assign(anim, refill())); await sleep(320);
    } while (findMatches().length > 0 && guard++ < 40);
  }

  // まとめる：自分で選んだ隣接2枚（同じ数字・同じ軸）を倍にする（1→2→4→8→16→32…）
  // ＝ 素材の入れかえと同じく「どれとどれを合わせるか」を選べる。
  //   a＝先に選んだ方／b＝後にタッチした方。まとまりは「後にタッチした b」に残す（直感に合わせて）。
  function jukuseiNameOf(v) { for (const t of JUKUSEI_TIERS) if (v >= t.min) return t.name; return null; }
  async function mergePair(a, b) {
    const tb = board[b.r][b.c];
    busy = true;
    const newValue = tb.value * 2;
    const mergePts = newValue * SCORE_MERGE_PER_VALUE;
    sessionScore += mergePts;
    // まとめると、次の1手ぶん発酵がひと休み（発酵バーは後退しない＝時間を稼げる）。
    // ただし貯金には上限あり：溜めすぎて発酵を凍結はできない（見きわめの緊張感を守る）
    const restGained = fermentSkip < FERMENT_SKIP_MAX;
    if (restGained) fermentSkip += 1;
    render({ [`${a.r},${a.c}`]: "pop" }); await sleep(160);
    board[a.r][a.c] = null;
    board[b.r][b.c] = makePanel(tb.axis, newValue);
    const juku = jukuseiNameOf(newValue);
    const restTxt = restGained ? "・⏸️発酵ひと休み" : "・⏸️は満タン";
    toast(`${AXIS_DEF[tb.axis].emoji}まとめた！ ${newValue}${juku ? `　✨${juku}` : ""}（+${mergePts}pt${restTxt}）`);
    render({ [`${b.r},${b.c}`]: "grow" }); await sleep(220);
    applyGravity();
    render(refill()); await sleep(160);
    busy = false;
  }

  // ---------- 酛（もと）：入れ替え→中心の3×3が消滅→中央にその軸のパネルが1枚生まれる ----------
  // 値は「入れ替えた素材(=1) ＋ まわり8マスのパネル数」で決まる（min1・max8）：1→1 / 2-4→2 / 5-7→4 / 8→8
  const motoValueByCount = (n) => n >= 8 ? 8 : n >= 5 ? 4 : n >= 2 ? 2 : 1;
  const inBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  function around3x3(pos) {
    const cells = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = pos.r + dr, cc = pos.c + dc;
      if (inBoard(rr, cc)) cells.push({ r: rr, c: cc, center: dr === 0 && dc === 0 });
    }
    return cells;
  }
  async function motoConvert(motoPos, ingPos, type) {
    busy = true;
    advanceFerment();
    // 中心＝酛が入れ替わって移動した先（＝素材の元の位置）。そこに新パネルが生まれる。
    const C = ingPos;
    const axis = TYPES[type].axis;
    // ① 入れ替え（素材→酛の位置、酛→素材の位置）を見せる。
    [board[motoPos.r][motoPos.c], board[ingPos.r][ingPos.c]] = [board[ingPos.r][ingPos.c], board[motoPos.r][motoPos.c]];
    render(); await sleep(170);
    // 消すのは「3×3内の素材だけ」。香り/こくパネルは両軸とも数えず・消さず、そのまま残す。
    // 値＝まわり8マスの素材の数（入れ替えた素材を含む。min1・max8）：1→1 / 2-4→2 / 5-7→4 / 8→8
    const clearCells = [];
    let ings = 0;
    for (const cell of around3x3(C)) {
      const t = board[cell.r][cell.c];
      if (cell.center) { clearCells.push(cell); continue; } // 中心＝入替後の酛→新パネルに
      if (!t || t.kind !== "ing") continue;                 // パネル・酛・空きは数えず残す
      ings++; clearCells.push(cell);                         // 素材→数えて消す
    }
    const count = Math.max(1, ings);
    const value = motoValueByCount(count);
    // ② 素材だけ消える（パネルは残る）
    const pop = {};
    for (const cell of clearCells) pop[`${cell.r},${cell.c}`] = "pop";
    render(pop); await sleep(200);
    for (const cell of clearCells) board[cell.r][cell.c] = null;
    // ③ まずその場で香り/こくパネルとして生まれる（未分離。連鎖と同じく一度その場で見せる）
    board[C.r][C.c] = makePanel(axis, value);
    const juku = jukuseiNameOf(value);
    const hasMergeTarget = [[-1,0],[1,0],[0,-1],[0,1]].some(([dr,dc]) => {
      const nr = C.r+dr, nc = C.c+dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return false;
      const t = board[nr][nc];
      return t && t.kind === "panel" && t.axis === axis && t.value === value;
    });
    const mergeHint = hasMergeTarget ? "　← まとめ候補！" : "";
    toast(`🫧 酛！ 素材${count}個 → ${AXIS_DEF[axis].emoji}${value}${juku ? `　✨${juku}` : ""}${mergeHint}`);
    render({ [`${C.r},${C.c}`]: "grow" }); await sleep(280);
    // ④ パネルはその場に止めたまま（中央落下はしない）→ そのまま上下へ分離。
    //    穴は分離の落下で素材が埋める。連鎖があれば連鎖。生まれた新パネルだけ立ちのぼり/沈み。
    await resolveBoard(null);
    await afterAction();
  }

  // ---------- 櫂入れ（よこ一列の素材をさらって、軸ごとにうまみへ） ----------
  function updateKaiireBtn() {
    kaiireBtn.textContent = `🥢 櫂入れ（のこり${kaiireLeft}）`;
    kaiireBtn.classList.toggle("active", kaiireMode);
    kaiireBtn.disabled = kaiireLeft <= 0;
  }
  function setKaiireMode(on) {
    kaiireMode = on && kaiireLeft > 0;
    document.body.classList.toggle("kaiire-mode", kaiireMode);
    updateKaiireBtn();
  }
  function toggleKaiire() {
    if (busy || gameOver) return;
    if (kaiireLeft <= 0) { toast("櫂入れはもうないよ"); return; }
    setKaiireMode(!kaiireMode);
    if (kaiireMode) toast("消したい素材をタップ！（同じ種類が全部消える）", 1);
  }
  async function kaiireType(typeId) {
    const cells = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = board[r][c];
      if (t && t.kind === "ing" && t.type === typeId) cells.push({ r, c });
    }
    if (cells.length === 0) { toast("その素材はタンクにないよ"); return; }
    busy = true;
    kaiireLeft--;
    advanceFerment();
    const popClasses = {};
    for (const p of cells) popClasses[`${p.r},${p.c}`] = "pop";
    render(popClasses);
    await sleep(220);
    for (const p of cells) board[p.r][p.c] = null;
    const def = TYPES[typeId];
    toast(`🥢 櫂入れ！ ${def.emoji}${def.name}×${cells.length}を消した`);
    applyGravity();
    render(refill());
    await sleep(200);
    busy = false;
    updateKaiireBtn();
    await afterAction();
  }

  async function afterAction() {
    if (!hasValidMove()) {
      const hasIng = board.some((row) => row.some((t) => t && t.kind === "ing"));
      if (hasIng) { toast("うごかせる手がないから混ぜなおすね！", 1); await sleep(400); shuffleIngredients(); }
      else { toast("タンクがいっぱい！しぼりどき！", 1); await sleep(400); shiboru(true); return; }
    }
    render(); busy = false;
  }

  function shuffleIngredients() {
    const cells = [], tiles = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
      if (board[r][c] && board[r][c].kind === "ing") { cells.push({ r, c }); tiles.push(board[r][c]); }
    for (let i = tiles.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
    cells.forEach((p, i) => { board[p.r][p.c] = tiles[i]; });
    let guard = 0;
    while ((findMatches().length > 0 || !hasValidMove()) && guard++ < 40) {
      for (const g of findMatches()) { const { r, c } = g.cells[0]; board[r][c] = makeIng(randType()); }
      if (!hasValidMove()) cells.forEach((p) => { board[p.r][p.c] = makeIng(randType()); });
    }
  }

  // ---------- しぼる ----------
  async function shiboru(forced = false) {
    if ((busy && !forced) || gameOver) return;
    gameOver = true; busy = true;

    const s = boardSums();
    const st = stageOf(ferment);
    const character = characterOf(s.kaori, s.koku);
    const juku = jukuseiBonus();
    const total = Math.max(0, Math.round((s.kaori + s.koku) * st.mult) - nigori + juku.bonus);
    const grade = gradeOf(total);
    const adj = adjOf(character);

    const prefData = PREFECTURES[curIdx()];
    const before = loadPrestige();
    const beforeRank = getRankIdx(before);
    const name = pickName(prefData);
    // 評価＝注文の理想への寄り具合（蔵の格が高いほど◎が厳しい＝熟練カーブ）
    const fit = evalFit(order.id, s.kaori, s.koku, beforeRank);

    toast(`🍶 しぼり！ ${st.name}でしぼった`);
    render(); await sleep(900);

    const cellar = loadCellar();
    cellar.unshift({ name, adj, grade, mark: fit.mark, total, date: Date.now() });
    if (cellar.length > CELLAR_MAX) cellar.length = CELLAR_MAX;
    saveCellar(cellar);

    // この県の蔵の格を積み上げる（積み上げ点 × タイミング倍率 × 注文倍率）
    const gain = Math.round((sessionScore + juku.bonus) * timingMult(ferment) * SCORE_ORDER_MULT[fit.mark]);
    const prestige = before + gain;
    progress.prestige[curIdx()] = prestige;
    saveProgress();

    const rankIdx = getRankIdx(prestige);
    const rank = RANKS[rankIdx];
    const next = RANKS[rankIdx + 1];
    const rankedUp = rankIdx > beforeRank;
    const tankGrows = rankedUp && ROWS_BY_RANK[rankIdx] > ROWS_BY_RANK[beforeRank];
    const conqueredNow = before < CONQUER_AT && prestige >= CONQUER_AT;
    const pref = prefData.n;
    const allDone = conqueredCount() >= PREFECTURES.length;
    const pct = next ? Math.min(100, Math.round(((prestige - rank.min) / (next.min - rank.min)) * 100)) : 100;

    document.getElementById("resultScore").textContent = fit.mark;
    document.getElementById("resultRank").textContent = `${adj}${grade}『${name}』`;
    document.getElementById("resultReaction").textContent = `🗣️ ${order.who}「${REACTIONS[fit.mark]}」`;
    const jukuStr = juku.name ? `　✨${juku.name}` : "";
    document.getElementById("resultOrders").textContent =
      `${timingLabel(ferment)}　${orderLabel(fit.mark)}${jukuStr}　→ ${gain}pt 獲得`;

    let nextLine, unlock = "";
    if (conqueredNow) {
      nextLine = allDone
        ? "🎌🎌 これで全国統一たっせい！おめでとう！"
        : `🎌 ${pref}を制覇！ 地図から次の地方をえらぼう（蔵の格 +${gain}）`;
      unlock = `🗾 全国 ${conqueredCount()}/${PREFECTURES.length} 制覇`;
    } else if (rankIdx >= RANKS.length - 1) {
      nextLine = `${pref} は制覇ずみ。べつの地方も育てよう（蔵の格 +${gain}）`;
    } else {
      nextLine = `あと ${next.min - prestige} で ${next.name}！　（蔵の格 +${gain}）`;
      if (rankedUp) unlock = unlockText(rankIdx, tankGrows);
    }

    document.getElementById("prestigeBox").innerHTML =
      `<div class="prestige-rank">${pref}　${KURA_EMOJI[rankIdx]} ${rank.name}${rankedUp ? "　✨昇格！" : ""}</div>` +
      `<div class="prestige-bar"><div class="prestige-fill" style="width:${pct}%"></div></div>` +
      `<div class="prestige-next">${nextLine}</div>` +
      (unlock ? `<div class="prestige-unlock">${unlock}</div>` : "");

    renderCellar(cellar);
    resultModal.classList.remove("hidden");
  }

  function unlockText(rankIdx, tankGrows) {
    const bits = [];
    if (tankGrows) bits.push(`🛢️ 次の仕込みからタンクが ${ROWS_BY_RANK[rankIdx]}行に広がる！`);
    if (rankIdx === 1) bits.push("🗣️ 新しいお客さんが来た！");
    if (rankIdx === 3) bits.push("✨ 品評会の審査がはじまる（名工の道）");
    bits.push(`${KURA_EMOJI[rankIdx]} 蔵が立派になった`);
    return "🎉 " + bits.join("／");
  }

  // ---------- 地図（県えらび） ----------
  function openMap() { renderMap(); mapModal.classList.remove("hidden"); }
  function closeMap() { mapModal.classList.add("hidden"); }
  function selectPref(idx) {
    progress.current = idx; saveProgress();
    closeMap(); startGame();
  }
  function renderMap() {
    document.getElementById("mapCount").textContent = `全国 ${conqueredCount()} / ${PREFECTURES.length} 制覇`;
    const wrap = document.getElementById("mapRegions");
    wrap.innerHTML = "";
    for (const rowIndices of MAP_ROWS) {
      const row = document.createElement("div"); row.className = "map-chips map-row";
      for (const i of rowIndices) {
        const chip = document.createElement("button"); chip.className = "map-chip";
        const conquered = isConquered(i);
        const rank = getRankIdx(prestigeOf(i));
        if (conquered) chip.classList.add("conquered");
        if (i === progress.current) chip.classList.add("current");
        const mark = conquered ? "🎌" : (prestigeOf(i) > 0 ? KURA_EMOJI[rank] : "・");
        chip.innerHTML = `<span class="mc-mark">${mark}</span><span class="mc-name">${prefName(i)}</span>`;
        chip.addEventListener("click", () => selectPref(i));
        row.appendChild(chip);
      }
      wrap.appendChild(row);
    }
  }

  // ---------- 蔵だな ----------
  function loadCellar() { try { return JSON.parse(localStorage.getItem(CELLAR_KEY) || "[]"); } catch (e) { return []; } }
  function saveCellar(c) { localStorage.setItem(CELLAR_KEY, JSON.stringify(c)); }
  function renderCellar(cellar) {
    const el = document.getElementById("cellarList"); if (!el) return;
    el.innerHTML = "";
    cellar.slice(0, 8).forEach((b) => {
      const li = document.createElement("div"); li.className = "cellar-bottle";
      li.textContent = `${b.mark} ${b.adj}${b.grade}『${b.name}』`; el.appendChild(li);
    });
  }

  // ---------- 開始 ----------
  function startGame() {
    const rankIdx = getRankIdx(loadPrestige());
    ROWS = ROWS_BY_RANK[rankIdx];
    boardEl.className = `board kura-rank-${rankIdx}`;
    const prestige = loadPrestige();
    const nextRank = RANKS[rankIdx + 1];
    const pct = nextRank ? Math.min(100, Math.round(((prestige - RANKS[rankIdx].min) / (nextRank.min - RANKS[rankIdx].min)) * 100)) : 100;
    infoPref.textContent     = prefName(curIdx());
    infoRank.textContent     = `${KURA_EMOJI[rankIdx]} ${RANKS[rankIdx].name}`;

    ferment = 0; nigori = 0; fermentSkip = 0; sessionScore = 0; selected = null; gameOver = false; busy = false;
    kaiireLeft = KAIIRE_CHARGES; setKaiireMode(false);
    initBoard();
    drawOrder();
    resultModal.classList.add("hidden");
    render(); renderOrder();
    updateKaiireBtn();
  }

  document.getElementById("helpBtn").addEventListener("click", () => helpModal.classList.remove("hidden"));
  document.getElementById("helpCloseBtn").addEventListener("click", () => helpModal.classList.add("hidden"));
  document.getElementById("restartBtn").addEventListener("click", startGame);
  document.getElementById("retryBtn").addEventListener("click", startGame);
  document.getElementById("mapBtn").addEventListener("click", openMap);
  document.getElementById("resultMapBtn").addEventListener("click", openMap);
  document.getElementById("mapCloseBtn").addEventListener("click", closeMap);
  shiboruBtn.addEventListener("click", () => { if (!busy && !gameOver) shiboru(false); });
  kaiireBtn.addEventListener("click", toggleKaiire);
  // ドラッグ／スワイプ検知（盤面外まで動いても拾えるよう document で受ける）
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", () => { dragStart = null; });

  startGame();
  helpModal.classList.remove("hidden");

  window.__tank2 = {
    getBoard: () => board,
    dims: () => ({ ROWS, COLS }),
    setIng: (r, c, type) => { board[r][c] = type === null ? null : makeIng(type); render(); },
    setPanel: (r, c, axis, value) => { board[r][c] = makePanel(axis, value); render(); },
    setMoto: (r, c) => { board[r][c] = makeMoto(); render(); },
    setFerment: (f) => { ferment = f; render(); },
    setPrefPrestige: (idx, p) => { progress.current = idx; progress.prestige[idx] = p; saveProgress(); },
    openMap, selectPref,
    state: () => ({ ferment, nigori, fermentSkip, order, busy, gameOver, sums: boardSums(), preview: brewPreview(), rankIdx: getRankIdx(loadPrestige()), ROWS, pref: prefName(curIdx()), prefIdx: curIdx(), aim: PREFECTURES[curIdx()].aim, conquered: conqueredCount() }),
    shiboru: () => shiboru(false),
    restart: startGame,
  };
})();
