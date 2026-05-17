// ============================================================
// Firebase設定
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyDkDHmZWYOq7lJ7onT5l6fcIH9Vr14lV8E",
    authDomain: "rps-super.firebaseapp.com",
    databaseURL: "https://rps-super-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "rps-super",
    storageBucket: "rps-super.firebasestorage.app",
    messagingSenderId: "573274865822",
    appId: "1:573274865822:web:143183f8d8a0c9c3e13b8f"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ============================================================
// スプライト定数（実測値: 1097x960, 4列3行）
// 列ごとに幅が異なるため個別に定義
// ============================================================
const SP_COL_X = [0, 278, 558, 826];   // 各列の開始X
const SP_COL_W = [278, 280, 268, 271]; // 各列の幅
const SP_ROW_Y = [0, 320, 640];        // 各行の開始Y
const SP_ROW_H = 320;                  // 行の高さ（均等）
const DISP_W   = 150;
const DISP_H   = 176;

// 画像プリロード
const spriteImg = new Image();
spriteImg.src = "chara_set.png";

const imgH1 = new Image(); imgH1.src = "heart1.png";
const imgH2 = new Image(); imgH2.src = "heart2.png";

// ============================================================
// グローバル状態
// ============================================================
let myRole    = null;
let roomRef   = null;
let resolving = false;

// ============================================================
// ボタン登録
// ============================================================
document.getElementById("btn-join").onclick        = onClickEnter;
document.getElementById("input-room-id").onkeydown = (e) => { if (e.key === "Enter") onClickEnter(); };
document.getElementById("btn-rock")    .onclick    = () => submitHand("rock");
document.getElementById("btn-paper")  .onclick    = () => submitHand("paper");
document.getElementById("btn-scissors").onclick    = () => submitHand("scissors");

// ============================================================
// ENTER ボタン処理
// ============================================================
function onClickEnter() {
    const roomId = document.getElementById("input-room-id").value.trim();
    if (!/^\d{4}$/.test(roomId)) { alert("4桁の数字を入力してください。"); return; }

    document.getElementById("btn-join").disabled      = true;
    document.getElementById("input-room-id").disabled = true;

    const ref = db.ref("rooms/" + roomId);

    ref.once("value")
        .then((snap) => {
            const data = snap.val();
            log("ルームデータ:", data);

            // ルームなし → player1 として新規作成
            if (!data) {
                myRole = "player1"; roomRef = ref;
                const charId = randCharId(null); // P1はランダム
                return ref.set({
                    player1:     { hp: 3, hand: "", connected: true,  charId: charId },
                    player2:     { hp: 3, hand: "", connected: false, charId: null   },
                    roundStatus: "waiting",
                    resultText:  ""
                });
            }

            const p1on = !!(data.player1 && data.player1.connected);
            const p2on = !!(data.player2 && data.player2.connected);

            // 両者オフライン（残骸） → リセットして player1
            if (!p1on && !p2on) {
                myRole = "player1"; roomRef = ref;
                const charId = randCharId(null);
                return ref.set({
                    player1:     { hp: 3, hand: "", connected: true,  charId: charId },
                    player2:     { hp: 3, hand: "", connected: false, charId: null   },
                    roundStatus: "waiting",
                    resultText:  ""
                });
            }

            // player1 だけオンライン → 自分が player2（P1と異なるキャラを選ぶ）
            if (p1on && !p2on) {
                myRole = "player2"; roomRef = ref;
                const p1charId = data.player1 ? data.player1.charId : null;
                const charId   = randCharId(p1charId); // P1と被らない
                return ref.child("player2").update({ hp: 3, hand: "", connected: true, charId: charId });
            }

            // player2 だけオンライン → player1 として再参加
            if (!p1on && p2on) {
                myRole = "player1"; roomRef = ref;
                const p2charId = data.player2 ? data.player2.charId : null;
                const charId   = randCharId(p2charId);
                return ref.child("player1").update({ hp: 3, hand: "", connected: true, charId: charId });
            }

            // 両者オンライン → 満員
            throw new Error("FULL");
        })
        .then(() => {
            log("書き込み完了 / role =", myRole);
            showGameScreen(document.getElementById("input-room-id").value.trim());
            startWatching();
        })
        .catch((err) => {
            log("エラー:", err.message);
            alert(err.message === "FULL" ? "このルームは満員です。" : "エラー: " + err.message);
            document.getElementById("btn-join").disabled      = false;
            document.getElementById("input-room-id").disabled = false;
        });
}

// 相手と被らないランダムなcharIdを返す（0〜3）
function randCharId(excludeId) {
    const ids = [0, 1, 2, 3].filter((id) => id !== excludeId);
    return ids[Math.floor(Math.random() * ids.length)];
}

function log(...a) { console.log("[RPS]", ...a); }

// ============================================================
// ゲーム画面へ切り替え
// ============================================================
function showGameScreen(roomId) {
    document.getElementById("setup-screen").style.display  = "none";
    document.getElementById("game-screen").style.display   = "flex";
    document.getElementById("display-room-id").textContent = roomId;
    document.getElementById("display-role").textContent    = myRole === "player1" ? "P1" : "P2";

    // canvas サイズ設定（face-wrap の実際のサイズに合わせる）
    const wraps = document.querySelectorAll(".face-wrap");
    const ids   = ["face-canvas-p1", "face-canvas-p2"];
    ids.forEach((id, i) => {
        const c = document.getElementById(id);
        const wrap = wraps[i];
        c.width  = wrap ? wrap.clientWidth  || DISP_W : DISP_W;
        c.height = wrap ? wrap.clientHeight || DISP_H : DISP_H;
    });

    log("ゲーム画面表示");
}

// ============================================================
// Firebase リアルタイム監視
// ============================================================
function startWatching() {
    log("監視開始");
    roomRef.on("value", (snap) => {
        const d = snap.val();
        if (!d) return;
        renderUI(d);

        // player1 だけが勝敗処理を担当
        // hand が空文字や null/undefined の場合は発火しない
        const p1hand = d.player1 && d.player1.hand;
        const p2hand = d.player2 && d.player2.hand;
        if (
            myRole === "player1"        &&
            !resolving                  &&
            d.roundStatus === "waiting" &&
            p1hand && p1hand !== ""     &&
            p2hand && p2hand !== ""     &&
            d.player2.connected
        ) {
            resolveRound(d);
        }
    });

    // ページ離脱時にルーム削除
    window.addEventListener("beforeunload", () => {
        if (roomRef) { roomRef.remove(); roomRef = null; }
    });
}

// ============================================================
// 手を出す
// ============================================================
function submitHand(hand) {
    if (!roomRef || !myRole) { log("未接続"); return; }
    roomRef.once("value").then((snap) => {
        const d = snap.val();
        if (!d)                                              return;
        if (d.roundStatus !== "waiting")                     { log("結果表示中"); return; }
        const myHand = d[myRole] && d[myRole].hand;
        if (myHand && myHand !== "")                         { log("選択済み"); return; }
        if (!d.player2 || !d.player2.connected)              { log("相手未接続"); return; }
        log("手を出す:", hand);
        roomRef.child(myRole + "/hand").set(hand);
    });
}

// ============================================================
// 勝敗処理（player1 のみ実行）
// ============================================================
function resolveRound(d) {
    if (resolving) return;
    resolving = true;

    const h1 = d.player1.hand;
    const h2 = d.player2.hand;

    // 手が両方とも有効な値か確認
    const valid = ["rock", "paper", "scissors"];
    if (!valid.includes(h1) || !valid.includes(h2)) {
        log("無効な手:", h1, h2);
        resolving = false;
        return;
    }

    const r = judge(h1, h2);
    let p1hp = d.player1.hp;
    let p2hp = d.player2.hp;
    let text = "";

    if      (r === "p1win") { p2hp = Math.max(0, p2hp - 1); text = "PLAYER 1 WIN !"; }
    else if (r === "p2win") { p1hp = Math.max(0, p1hp - 1); text = "PLAYER 2 WIN !"; }
    else                    { text = "DRAW"; }

    const over = p1hp <= 0 || p2hp <= 0;
    if (p1hp <= 0) text = "PLAYER 1 LOSE  --  GAME OVER";
    if (p2hp <= 0) text = "PLAYER 2 LOSE  --  GAME OVER";

    log("判定:", h1, "vs", h2, "->", r, "|", text);

    roomRef.update({
        "player1/hp":   p1hp,
        "player2/hp":   p2hp,
        "player1/hand": h1,
        "player2/hand": h2,
        roundStatus:    "result",
        resultText:     text
    }).then(() => {
        if (over) {
            setTimeout(() => {
                if (roomRef) roomRef.remove().then(() => { log("ルーム削除"); roomRef = null; });
            }, 3000);
            resolving = false;
            return;
        }
        setTimeout(() => {
            if (!roomRef) { resolving = false; return; }
            roomRef.update({
                "player1/hand": "",
                "player2/hand": "",
                roundStatus:    "waiting",
                resultText:     ""
            }).then(() => { resolving = false; });
        }, 3000);
    });
}

// じゃんけん判定
// rock     > scissors
// scissors > paper
// paper    > rock
function judge(h1, h2) {
    if (h1 === h2) return "draw";
    if (
        (h1 === "rock"     && h2 === "scissors") ||
        (h1 === "scissors" && h2 === "paper")    ||
        (h1 === "paper"    && h2 === "rock")
    ) return "p1win";
    return "p2win";
}

// ============================================================
// UI 描画
// ============================================================
function renderUI(d) {
    const p1   = d.player1;
    const p2   = d.player2;
    const p2on = !!(p2 && p2.connected);

    renderHearts("p1-hp-row", p1 ? p1.hp : 0);
    if (p2on) {
        renderHearts("p2-hp-row", p2.hp);
    } else {
        document.getElementById("p2-hp-row").innerHTML =
            '<span class="hp-waiting">WAITING...</span>';
    }

    drawFace("face-canvas-p1", p1);
    drawFace("face-canvas-p2", p2on ? p2 : null);
    renderBattle(d);
}

// ============================================================
// ハート HP 表示
// ============================================================
function renderHearts(containerId, hp) {
    const el = document.getElementById(containerId);
    el.innerHTML = "";
    for (let i = 0; i < 3; i++) {
        const img = document.createElement("img");
        img.src   = i < hp ? imgH1.src : imgH2.src;
        img.width = img.height = 28;
        img.style.imageRendering = "pixelated";
        el.appendChild(img);
    }
}

// ============================================================
// 顔スプライト描画（列ごとに幅が違うため個別座標を使用）
// ============================================================
function drawFace(canvasId, playerData) {
    const cvs = document.getElementById(canvasId);
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const w = cvs.width;
    const h = cvs.height;
    ctx.clearRect(0, 0, w, h);

    if (!playerData || playerData.charId == null) {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, w, h);
        return;
    }

    const doRender = () => {
        const col = playerData.charId;        // 0〜3（横）
        const row = spriteRow(playerData.hp); // 0〜2（縦）

        const sx = SP_COL_X[col]; // 列ごとの正確な開始X
        const sw = SP_COL_W[col]; // 列ごとの正確な幅
        const sy = SP_ROW_Y[row]; // 行の開始Y
        const sh = SP_ROW_H;      // 行の高さ

        ctx.drawImage(spriteImg, sx, sy, sw, sh, 0, 0, w, h);
    };

    if (spriteImg.complete && spriteImg.naturalWidth > 0) {
        doRender();
    } else {
        spriteImg.onload = doRender;
    }
}

// HP に応じたスプライト行（0=通常, 1=ダメージ, 2=瀕死）
function spriteRow(hp) {
    if (hp >= 3) return 0;
    if (hp === 2) return 1;
    return 2;
}

// ============================================================
// バトルフィールド表示
// ============================================================
function renderBattle(d) {
    const el     = document.getElementById("battle-text");
    const p2on   = !!(d.player2 && d.player2.connected);
    const status = d.roundStatus || "waiting";

    if (!p2on) {
        el.innerHTML = '<span style="color:#00ffff;">相手の参加を待っています...</span>';
        return;
    }

    const myHand  = d[myRole]  ? d[myRole].hand  : "";
    const oppRole = myRole === "player1" ? "player2" : "player1";
    const oppHand = d[oppRole] ? d[oppRole].hand  : "";

    let html = '<div class="hand-row">';

    // 自分の手
    html += '<div class="hand-cell"><span>あなた</span>';
    html += myHand
        ? '<img class="hand-img" src="' + handSrc(myHand) + '">'
        : '<div class="hand-placeholder">?</div>';
    html += '</div>';

    html += '<div class="vs-label">VS</div>';

    // 相手の手（結果時のみ公開）
    html += '<div class="hand-cell"><span>相手</span>';
    if (status === "result" && oppHand) {
        html += '<img class="hand-img" src="' + handSrc(oppHand) + '">';
    } else if (oppHand) {
        html += '<div class="hand-placeholder">...</div>';
    } else {
        html += '<div class="hand-placeholder">?</div>';
    }
    html += '</div>';

    html += '</div>';

    if (status === "result") {
        html += '<div class="result-text">' + (d.resultText || "") + '</div>';
    }

    el.innerHTML = html;
}

function handSrc(hand) {
    return { rock: "gu.png", paper: "pa.png", scissors: "choki.png" }[hand] || "";
}
