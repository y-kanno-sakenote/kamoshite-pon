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
  // B：テーマ色（盤面の地＝その土地の水の色）
  const THEME_COLORS = {
    snow: "#eef3f8", sea: "#e3f0f7", mountain: "#eef4e6",
    city: "#ededed", south: "#fdeecf", field: "#f5efe1", blossom: "#fbeaf0",
  };
  // 熟練カーブ：◎を出すのに必要な「理想への寄り具合」（蔵の格ランク別。上がるほど厳しい）
  const MARU_THRESHOLD = [0.55, 0.60, 0.66, 0.72, 0.78];
  const MARU_MARGIN = 0.13; // この差以内なら○

  const CELLAR_KEY = "kamoshitepon_tank_cellar_v1";
  const CELLAR_MAX = 60;

  const RANKS = [
    { min: 0, name: "みならい蔵" }, { min: 150, name: "蔵人の蔵" }, { min: 400, name: "銘酒蔵" },
    { min: 800, name: "名門蔵" }, { min: 1500, name: "伝説の蔵" },
  ];
  const ROWS_BY_RANK = [6, 6, 7, 7, 8];
  const KURA_EMOJI = ["🛖", "🏚️", "🏠", "🏯", "🏯"];
  const CONQUER_AT = RANKS[RANKS.length - 1].min; // 伝説の蔵＝制覇
  const REACTIONS = {
    "◎": "これこれ！こういうのが飲みたかった！", "○": "うん、なかなかいけるね。", "△": "ふむ、これはこれで乙なもんだ。",
  };

  // 全47都道府県（ステージ）。順番自由・地図から選ぶ
  // n=県名, aim=目指す味, style=味の一言, theme=地の色, names=ご当地銘柄
  const PREFECTURES = [
    { n: "北海道", aim: "balance", style: "大地の旨み", theme: "snow", names: ["大地", "流氷"] },
    { n: "青森", aim: "kaori", style: "りんごの華", theme: "blossom", names: ["りんご花", "八甲田"] },
    { n: "岩手", aim: "koku", style: "南部の厚み", theme: "mountain", names: ["南部の里", "北上"] },
    { n: "宮城", aim: "balance", style: "潮のうまみ", theme: "sea", names: ["伊達の蔵", "松島"] },
    { n: "秋田", aim: "kaori", style: "すっきり淡麗", theme: "snow", names: ["美郷", "雪きらり"] },
    { n: "山形", aim: "kaori", style: "フルーティ", theme: "blossom", names: ["さくらんぼ", "蔵王"] },
    { n: "福島", aim: "balance", style: "桃のふくらみ", theme: "blossom", names: ["桃源", "会津路"] },
    { n: "茨城", aim: "koku", style: "骨太", theme: "field", names: ["筑波おろし", "常陸野"] },
    { n: "栃木", aim: "kaori", style: "苺の香", theme: "blossom", names: ["苺の里", "日光"] },
    { n: "群馬", aim: "koku", style: "温泉仕込み", theme: "mountain", names: ["草津の湯", "赤城"] },
    { n: "埼玉", aim: "balance", style: "武蔵野", theme: "field", names: ["川越", "武蔵野"] },
    { n: "千葉", aim: "koku", style: "香ばし", theme: "sea", names: ["房総", "九十九里"] },
    { n: "東京", aim: "kaori", style: "粋", theme: "city", names: ["江戸前", "隅田"] },
    { n: "神奈川", aim: "balance", style: "潮風", theme: "sea", names: ["湘南", "箱根路"] },
    { n: "新潟", aim: "koku", style: "淡麗辛口", theme: "snow", names: ["雪国", "越路"] },
    { n: "富山", aim: "balance", style: "雪解けの清", theme: "snow", names: ["立山", "雪解け"] },
    { n: "石川", aim: "koku", style: "加賀の格", theme: "sea", names: ["加賀の金", "兼六"] },
    { n: "福井", aim: "koku", style: "越前の厚み", theme: "sea", names: ["越前", "永平寺"] },
    { n: "山梨", aim: "kaori", style: "ぶどうの香", theme: "blossom", names: ["ぶどう坂", "富士みち"] },
    { n: "長野", aim: "kaori", style: "高原の澄み", theme: "mountain", names: ["アルプス", "信濃路"] },
    { n: "岐阜", aim: "balance", style: "清流", theme: "mountain", names: ["清流", "飛騨路"] },
    { n: "静岡", aim: "kaori", style: "メロン香", theme: "sea", names: ["茶の香", "富士見"] },
    { n: "愛知", aim: "koku", style: "赤味噌のコク", theme: "city", names: ["尾張", "三河"] },
    { n: "三重", aim: "kaori", style: "伊勢の雅", theme: "field", names: ["伊勢路", "五十鈴"] },
    { n: "滋賀", aim: "koku", style: "湖のうまみ", theme: "field", names: ["湖の里", "比叡おろし"] },
    { n: "京都", aim: "kaori", style: "やわらか", theme: "city", names: ["雅", "伏見の水"] },
    { n: "大阪", aim: "balance", style: "浪花のにぎわい", theme: "city", names: ["浪花", "通天"] },
    { n: "兵庫", aim: "koku", style: "芳醇旨口", theme: "field", names: ["山田の穂", "灘の蔵"] },
    { n: "奈良", aim: "koku", style: "古都の重み", theme: "mountain", names: ["古都", "吉野"] },
    { n: "和歌山", aim: "balance", style: "紀州の澄み", theme: "sea", names: ["紀州", "熊野路"] },
    { n: "鳥取", aim: "koku", style: "砂丘の力", theme: "sea", names: ["砂丘", "大山おろし"] },
    { n: "島根", aim: "koku", style: "神話の厚み", theme: "mountain", names: ["出雲", "神在"] },
    { n: "岡山", aim: "koku", style: "白桃のふくらみ", theme: "blossom", names: ["白桃", "吉備路"] },
    { n: "広島", aim: "kaori", style: "やわ口", theme: "sea", names: ["瀬戸の風", "安芸"] },
    { n: "山口", aim: "kaori", style: "関の華", theme: "sea", names: ["関の潮", "錦帯"] },
    { n: "徳島", aim: "koku", style: "渦の力", theme: "sea", names: ["渦潮", "阿波おどり"] },
    { n: "香川", aim: "balance", style: "讃岐の凪", theme: "sea", names: ["讃岐", "オリーブ凪"] },
    { n: "愛媛", aim: "balance", style: "橘の香", theme: "south", names: ["伊予の橘", "道後"] },
    { n: "高知", aim: "koku", style: "男酒のキレ", theme: "sea", names: ["土佐の波", "四万十"] },
    { n: "福岡", aim: "balance", style: "博多の甘", theme: "south", names: ["あまおう", "博多"] },
    { n: "佐賀", aim: "koku", style: "有田の濃醇", theme: "field", names: ["有田", "嬉野"] },
    { n: "長崎", aim: "kaori", style: "出島の華", theme: "sea", names: ["出島", "五島"] },
    { n: "熊本", aim: "kaori", style: "火の国の熱", theme: "south", names: ["火の国", "阿蘇"] },
    { n: "大分", aim: "balance", style: "かぼすの爽", theme: "mountain", names: ["別府", "かぼす"] },
    { n: "宮崎", aim: "kaori", style: "南国の甘香", theme: "south", names: ["日向", "マンゴー"] },
    { n: "鹿児島", aim: "koku", style: "薩摩の豪快", theme: "south", names: ["桜島", "薩摩"] },
    { n: "沖縄", aim: "balance", style: "島の風", theme: "south", names: ["島風", "さんご礁"] },
  ];
  const prefName = (i) => PREFECTURES[i].n;
  const REGIONS = [
    { name: "北海道", indices: [0] },
    { name: "東北", indices: [1, 2, 3, 4, 5, 6] },
    { name: "関東", indices: [7, 8, 9, 10, 11, 12, 13] },
    { name: "中部", indices: [14, 15, 16, 17, 18, 19, 20, 21, 22] },
    { name: "近畿", indices: [23, 24, 25, 26, 27, 28, 29] },
    { name: "中国", indices: [30, 31, 32, 33, 34] },
    { name: "四国", indices: [35, 36, 37, 38] },
    { name: "九州・沖縄", indices: [39, 40, 41, 42, 43, 44, 45, 46] },
  ];

  // 進捗：県ごとの蔵の格＋現在いる県（localStorage）
  const PROGRESS_KEY = "kamoshitepon_tank_progress_v1";
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
  let order = null;
  let selected = null;
  let busy = false;
  let gameOver = false;
  let kaiireLeft = KAIIRE_CHARGES;  // 残り櫂入れ回数
  let kaiireMode = false;           // 櫂入れの列えらび中か

  // ---------- DOM ----------
  const boardEl = document.getElementById("board");
  const kaoriEl = document.getElementById("kaoriVal");
  const kokuEl = document.getElementById("kokuVal");
  const orderEl = document.getElementById("orderLine");
  const statusEl = document.getElementById("statusLine");
  const toastLayer = document.getElementById("toastLayer");
  const shiboruBtn = document.getElementById("shiboruBtn");
  const shiboruFill = document.getElementById("shiboruFill");
  const shiboruLabel = document.getElementById("shiboruLabel");
  const kaiireBtn = document.getElementById("kaiireBtn");
  const subtitleEl = document.querySelector(".subtitle");
  const helpModal = document.getElementById("helpModal");
  const resultModal = document.getElementById("resultModal");
  const mapModal = document.getElementById("mapModal");

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
        cell.title = `${def.name}パネル（${t.value}）`;
        const vb = document.createElement("span"); vb.className = "value-badge"; vb.textContent = t.value; cell.appendChild(vb);
      } else if (t.kind === "moto") {
        cell.classList.add("moto-cell");
        cell.textContent = "🫧";
        cell.title = "酛（もと）：タップでまわり8マスを今の注文の味に変える";
      }
      const key = `${r},${c}`;
      if (extraClasses[key]) cell.classList.add(extraClasses[key]);
      if (selected && selected.r === r && selected.c === c) cell.classList.add("selected");
      cell.addEventListener("pointerdown", onCellTap);
      boardEl.appendChild(cell);
    }
    updateHud();
  }

  function updateHud() {
    const s = boardSums();
    kaoriEl.textContent = s.kaori; kokuEl.textContent = s.koku;
    const b = brewPreview();
    // 盤面の地＝その県のテーマ色（B）。バランスは数値で見えるので地の色はご当地色に
    boardEl.style.background = THEME_COLORS[PREFECTURES[curIdx()].theme] || "transparent";
    // 仕上がり予報：今しぼったらどんな酒で、注文に◎○△か＋どっちに寄せるか
    if (order) {
      const rankIdx = getRankIdx(loadPrestige());
      const fit = evalFit(order.id, s.kaori, s.koku, rankIdx);
      const nigoriTxt = nigori > 0 ? `（にごり -${nigori}）` : "";
      statusEl.textContent = `いまの一本：${b.adj}${b.grade}${nigoriTxt}　ご注文 ${fit.mark}${fitNudge(order.id, s.kaori, s.koku, fit.mark)}`;
      // 目標の軸をHUDで強調
      const wantKa = order.id === "kaori" || order.id === "balance";
      const wantKo = order.id === "koku" || order.id === "balance";
      kaoriEl.parentElement.classList.toggle("target", wantKa);
      kokuEl.parentElement.classList.toggle("target", wantKo);
    }
    // しぼるボタン＝発酵バー：満ち具合（width）と色・言葉で進捗を伝える
    shiboruFill.style.width = `${Math.min(100, ferment)}%`;
    let fillCls, label;
    if (ferment >= PEAK_HI) { fillCls = "s-over"; label = "🍶 はやくしぼって！"; }
    else if (ferment >= PEAK_LO) { fillCls = "s-peak"; label = "🍶 いまだ！しぼる"; }
    else if (ferment >= 40) { fillCls = "s-ready"; label = "🍶 しぼる"; }
    else { fillCls = "s-young"; label = "🍶 しぼる（まだあまい）"; }
    shiboruFill.className = `shiboru-fill ${fillCls}`;
    shiboruLabel.textContent = label;
    shiboruBtn.classList.toggle("peak-now", ferment >= PEAK_LO && ferment < PEAK_HI);
  }

  // ---------- 出来 ----------
  function stageOf(f) { let s = STAGES[0]; for (const st of STAGES) if (f >= st.min) s = st; return s; }
  function gradeOf(total) { let g = GRADE_TIERS[0].name; for (const t of GRADE_TIERS) if (total >= t.min) g = t.name; return g; }
  function characterOf(ka, ko) { if (ka > ko * 1.3) return "kaori"; if (ko > ka * 1.3) return "koku"; return "balance"; }
  function adjOf(ch) { return ch === "kaori" ? "華やかな" : ch === "koku" ? "ふくよかな" : "ととのった"; }
  function brewPreview() {
    const s = boardSums(); const st = stageOf(ferment);
    const total = Math.max(0, Math.round((s.kaori + s.koku) * st.mult) - nigori);
    const ch = characterOf(s.kaori, s.koku);
    return { total, grade: gradeOf(total), character: ch, adj: adjOf(ch) };
  }
  // A：その県の理想(aim)へどれだけ寄ったか（0〜1）
  function leanToward(aim, ka, ko) {
    const total = ka + ko;
    if (total <= 0) return 0;
    if (aim === "kaori") return ka / total;
    if (aim === "koku") return ko / total;
    return 1 - Math.abs(ka - ko) / total; // balance
  }
  // 評価：理想への寄り × 蔵の格（熟練カーブ）で ◎○△
  // 仕上がり予報のひとこと（◎なら満足、それ以外はどっちに寄せるか）
  function fitNudge(aimId, ka, ko, mark) {
    if (mark === "◎") return " ばっちり！";
    let push;
    if (aimId === "kaori") push = "もっと香りを";
    else if (aimId === "koku") push = "もっとこくを";
    else push = ka > ko ? "こくを足して" : "香りを足して";
    return `（${push}）`;
  }
  function evalFit(aimId, ka, ko, rankIdx) {
    const lean = leanToward(aimId, ka, ko);
    const need = MARU_THRESHOLD[rankIdx];
    if (lean >= need) return { mark: "◎", word: "ご注文どおり！大満足！" };
    if (lean >= need - MARU_MARGIN) return { mark: "○", word: "おしい！あと一歩" };
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
  function renderOrder() { orderEl.textContent = `📜 ${order.who}：${order.wish}（${order.hint}）`; }

  function advanceFerment() {
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
        if (t.kind === "panel") { if (t.axis === AXIS.KAORI) kaoriPanels.push(t); else kokuPanels.push(t); }
        else ingredients.push(t); // 素材・酛は中段で落ちる
      }
      const nulls = Array(ROWS - kaoriPanels.length - ingredients.length - kokuPanels.length).fill(null);
      const newCol = [...kaoriPanels, ...nulls, ...ingredients, ...kokuPanels];
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

  function onCellTap(e) {
    if (busy || gameOver) return;
    const r = Number(e.currentTarget.dataset.r), c = Number(e.currentTarget.dataset.c);
    if (kaiireMode) { setKaiireMode(false); kaiireRow(r); return; }
    const t = board[r][c];
    if (!t) return;
    if (t.kind === "panel") { selected = null; mergePanelAt(r, c); return; }
    // 酛は素材と同じく「えらんで入れかえ」できる（入れかえた素材が3×3に広がる）
    if (selected === null) { selected = { r, c }; render(); return; }
    const same = selected.r === r && selected.c === c;
    const adj = Math.abs(selected.r - r) + Math.abs(selected.c - c) === 1;
    if (same) { selected = null; render(); }
    else if (adj) { const from = selected; selected = null; trySwap(from, { r, c }); }
    else { selected = { r, c }; render(); }
  }

  async function trySwap(a, b) {
    const ta = board[a.r][a.c], tb = board[b.r][b.c];
    // 酛＋素材 → 入れかえた素材を酛の位置に3×3展開
    if (ta.kind === "moto" || tb.kind === "moto") {
      const motoPos = ta.kind === "moto" ? a : b;
      const ingTile = ta.kind === "moto" ? tb : ta;
      if (ingTile.kind !== "ing") { selected = null; render(); return; }
      await motoSpread(motoPos, ingTile.type);
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

  async function resolveBoard(originCell) {
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
      render(popClasses); await sleep(200);
      for (const g of groups) for (const p of g.cells) board[p.r][p.c] = null;
      const growClasses = {};
      for (const s of spawns) { board[s.r][s.c] = makePanel(s.axis, s.value); growClasses[`${s.r},${s.c}`] = "grow"; }
      const def = spawns.length ? AXIS_DEF[spawns[0].axis] : null;
      if (def) toast(combo >= 2 ? `れんぞく x${combo}！うまみパネル！` : `${def.emoji}${def.name}パネルが生まれた！`);
      applyGravity();
      render(Object.assign(growClasses, refill())); await sleep(220);
      originCell = null;
      groups = findMatches();
    }
  }

  async function mergePanelAt(r, c) {
    const tile = board[r][c];
    const group = []; const seen = new Set(); const stack = [{ r, c }];
    while (stack.length) {
      const p = stack.pop(); const key = `${p.r},${p.c}`;
      if (seen.has(key)) continue; seen.add(key);
      if (p.r < 0 || p.r >= ROWS || p.c < 0 || p.c >= COLS) continue;
      const t = board[p.r][p.c];
      if (!t || t.kind !== "panel" || t.axis !== tile.axis || t.value !== tile.value) continue;
      group.push(p);
      stack.push({ r: p.r + 1, c: p.c }, { r: p.r - 1, c: p.c }, { r: p.r, c: p.c + 1 }, { r: p.r, c: p.c - 1 });
    }
    if (group.length < 2) { toast("同じ数字のとなりがいないと、まとめられないよ"); return; }
    busy = true;
    const newValue = group.length * tile.value;
    const popClasses = {};
    for (const p of group) if (p.r !== r || p.c !== c) popClasses[`${p.r},${p.c}`] = "pop";
    render(popClasses); await sleep(160);
    for (const p of group) if (p.r !== r || p.c !== c) board[p.r][p.c] = null;
    board[r][c] = makePanel(tile.axis, newValue);
    toast(`${AXIS_DEF[tile.axis].emoji}まとめた！ ${newValue}`);
    render({ [`${r},${c}`]: "grow" }); await sleep(220);
    applyGravity();
    render(refill()); await sleep(160);
    busy = false;
  }

  // ---------- 酛（もと）：入れかえた素材を、酛の位置に3×3（9マス）展開 ----------
  async function motoSpread(pos, type) {
    busy = true;
    advanceFerment();
    const grow = {};
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = pos.r + dr, cc = pos.c + dc;
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
      const t = board[rr][cc];
      if (t && (t.kind === "ing" || t.kind === "moto")) {
        board[rr][cc] = makeIng(type);
        grow[`${rr},${cc}`] = "grow";
      }
    }
    toast(`🫧 酛！ ${TYPES[type].name}が9マスに広がった`);
    render(grow);
    await sleep(320);
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
    if (kaiireMode) toast("よこ一列をタップして櫂入れ！", 1);
  }
  async function kaiireRow(r) {
    const cells = [];
    for (let c = 0; c < COLS; c++) {
      const t = board[r][c];
      if (t && t.kind === "ing") cells.push({ r, c });
    }
    if (cells.length === 0) { toast("この列には素材がないよ"); return; }
    busy = true;
    kaiireLeft--;
    advanceFerment();
    // よこ一列の素材をさらって消す（お掃除・立て直し。うまみは増えない）
    const popClasses = {};
    for (const p of cells) popClasses[`${p.r},${p.c}`] = "pop";
    render(popClasses);
    await sleep(220);
    for (const p of cells) board[p.r][p.c] = null;
    toast("🥢 櫂入れ！ よこ一列をきれいにした");
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
    const total = Math.max(0, Math.round((s.kaori + s.koku) * st.mult) - nigori);
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

    // この県の蔵の格を積み上げる
    const tip = fit.mark === "◎" ? order.tip : fit.mark === "○" ? Math.round(order.tip * 0.4) : 0;
    const gain = total + tip;
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
    document.getElementById("resultOrders").textContent =
      `${pref}｜かおり ${s.kaori}／こく ${s.koku}${nigori ? `（にごり -${nigori}）` : ""}・${st.name}でしぼり`;

    let nextLine, unlock = "";
    if (conqueredNow) {
      nextLine = allDone
        ? "🎌🎌 これで全国統一たっせい！おめでとう！"
        : `🎌 ${pref}を制覇！ 地図から次の県をえらぼう（蔵の格 +${gain}）`;
      unlock = `🗾 全国 ${conqueredCount()}/${PREFECTURES.length} 制覇`;
    } else if (rankIdx >= RANKS.length - 1) {
      nextLine = `${pref} は制覇ずみ。べつの県も育てよう（蔵の格 +${gain}）`;
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
    for (const reg of REGIONS) {
      const sec = document.createElement("div"); sec.className = "map-region";
      const h = document.createElement("div"); h.className = "map-region-name"; h.textContent = reg.name; sec.appendChild(h);
      const row = document.createElement("div"); row.className = "map-chips";
      for (const i of reg.indices) {
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
      sec.appendChild(row); wrap.appendChild(sec);
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
    if (subtitleEl) {
      subtitleEl.textContent =
        `🗾 ${prefName(curIdx())}・${KURA_EMOJI[rankIdx]} ${RANKS[rankIdx].name}（全国 ${conqueredCount()}/${PREFECTURES.length}）`;
    }
    ferment = 0; nigori = 0; selected = null; gameOver = false; busy = false;
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

  startGame();
  helpModal.classList.remove("hidden");

  window.__tank = {
    getBoard: () => board,
    dims: () => ({ ROWS, COLS }),
    setIng: (r, c, type) => { board[r][c] = type === null ? null : makeIng(type); render(); },
    setPanel: (r, c, axis, value) => { board[r][c] = makePanel(axis, value); render(); },
    setMoto: (r, c) => { board[r][c] = makeMoto(); render(); },
    setFerment: (f) => { ferment = f; render(); },
    setPrefPrestige: (idx, p) => { progress.current = idx; progress.prestige[idx] = p; saveProgress(); },
    openMap, selectPref,
    state: () => ({ ferment, nigori, order, busy, gameOver, sums: boardSums(), preview: brewPreview(), rankIdx: getRankIdx(loadPrestige()), ROWS, pref: prefName(curIdx()), prefIdx: curIdx(), aim: PREFECTURES[curIdx()].aim, conquered: conqueredCount() }),
    shiboru: () => shiboru(false),
    restart: startGame,
  };
})();
