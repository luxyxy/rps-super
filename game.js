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
// スプライト座標
// ============================================================
const SP_COL_X = [4,   279, 554, 829];
const SP_COL_W = [270, 275, 270, 267];
const SP_ROW_Y = [4,   300, 605];
const SP_ROW_H = [291, 300, 252];
const DISP_W   = 150;
const DISP_H   = 176;

// 画像プリロード
const spriteImg = new Image(); spriteImg.src = "chara_set.png";
const imgH1     = new Image(); imgH1.src     = "heart1.png";
const imgH2     = new Image(); imgH2.src     = "heart2.png";

// ============================================================
// グローバル状態
// ============================================================
let myRole      = null;
let roomRef     = null;
let resolving   = false;
let gameOver    = false;   // ゲームオーバー中フラグ
let chatRef     = null;    // チャット用リファレンス
let chatLoaded  = false;   // 初回チャットロード済みフラグ

// ============================================================
// ボタン登録
// ============================================================
document.getElementById("btn-join")    .onclick    = onClickEnter;
document.getElementById("input-room-id").onkeydown = (e) => { if (e.key === "Enter") onClickEnter(); };
document.getElementById("btn-rock")    .onclick    = () => submitHand("rock");
document.getElementById("btn-paper")  .onclick    = () => submitHand("paper");
document.getElementById("btn-scissors").onclick    = () => submitHand("scissors");
document.getElementById("btn-retry")  .onclick    = onClickRetry;
document.getElementById("btn-send")   .onclick    = sendChat;
document.getElementById("chat-input") .onkeydown  = (e) => { if (e.key === "Enter") sendChat(); };

// 絵文字ボタン
["emo1","emo2","emo3","emo4"].forEach((id) => {
    document.getElementById("btn-" + id).onclick = () => sendEmoji(id);
});

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

            if (!data) {
                myRole = "player1"; roomRef = ref;
                return ref.set({
                    player1:     { hp: 3, hand: "", connected: true,  charId: randCharId(null) },
                    player2:     { hp: 3, hand: "", connected: false, charId: null },
                    roundStatus: "waiting",
                    resultText:  "",
                    retryRequest: { player1: false, player2: false }
                });
            }

            const p1on = !!(data.player1 && data.player1.connected);
            const p2on = !!(data.player2 && data.player2.connected);

            if (!p1on && !p2on) {
                myRole = "player1"; roomRef = ref;
                return ref.set({
                    player1:     { hp: 3, hand: "", connected: true,  charId: randCharId(null) },
                    player2:     { hp: 3, hand: "", connected: false, charId: null },
                    roundStatus: "waiting",
                    resultText:  "",
                    retryRequest: { player1: false, player2: false }
                });
            }
            if (p1on && !p2on) {
                myRole = "player2"; roomRef = ref;
                return ref.child("player2").update({
                    hp: 3, hand: "", connected: true, charId: randCharId(data.player1 ? data.player1.charId : null)
                });
            }
            if (!p1on && p2on) {
                myRole = "player1"; roomRef = ref;
                return ref.child("player1").update({
                    hp: 3, hand: "", connected: true, charId: randCharId(data.player2 ? data.player2.charId : null)
                });
            }

            throw new Error("FULL");
        })
        .then(() => {
            log("書き込み完了 / role =", myRole);
            showGameScreen(document.getElementById("input-room-id").value.trim());
            startWatching();
            startChat();
        })
        .catch((err) => {
            log("エラー:", err.message);
            alert(err.message === "FULL" ? "このルームは満員です。" : "エラー: " + err.message);
            document.getElementById("btn-join").disabled      = false;
            document.getElementById("input-room-id").disabled = false;
        });
}

function randCharId(excludeId) {
    const ids = [0, 1, 2, 3].filter((id) => id !== excludeId);
    return ids[Math.floor(Math.random() * ids.length)];
}
function log(...a) { console.log("[RPS]", ...a); }

// ============================================================
// ゲーム画面表示
// ============================================================
function showGameScreen(roomId) {
    document.getElementById("setup-screen").style.display  = "none";
    document.getElementById("game-screen").style.display   = "flex";
    document.getElementById("display-room-id").textContent = roomId;

    const wraps = document.querySelectorAll(".face-wrap");
    ["face-canvas-p1", "face-canvas-p2"].forEach((id, i) => {
        const c    = document.getElementById(id);
        const wrap = wraps[i];
        c.width  = wrap ? (wrap.clientWidth  || DISP_W) : DISP_W;
        c.height = wrap ? (wrap.clientHeight || DISP_H) : DISP_H;
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

        // 両者が手を出したらplayer1が判定
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

        // RETRY両者同意チェック（player1が処理）
        if (
            myRole === "player1"  &&
            gameOver              &&
            d.retryRequest        &&
            d.retryRequest.player1 === true &&
            d.retryRequest.player2 === true
        ) {
            doRetry(d);
        }
    });

    window.addEventListener("beforeunload", () => {
        if (roomRef) { roomRef.remove(); roomRef = null; }
    });
}

// ============================================================
// 手を出す
// ============================================================
function submitHand(hand) {
    if (!roomRef || !myRole || gameOver) return;
    roomRef.once("value").then((snap) => {
        const d = snap.val();
        if (!d) return;
        if (d.roundStatus !== "waiting")        return;
        const myHand = d[myRole] && d[myRole].hand;
        if (myHand && myHand !== "")            return;
        if (!d.player2 || !d.player2.connected) return;
        log("手を出す:", hand);
        roomRef.child(myRole + "/hand").set(hand);
    });
}

// ============================================================
// 勝敗処理（player1のみ）
// ============================================================
function resolveRound(d) {
    if (resolving) return;
    resolving = true;

    const h1 = d.player1.hand;
    const h2 = d.player2.hand;
    const valid = ["rock", "paper", "scissors"];
    if (!valid.includes(h1) || !valid.includes(h2)) { resolving = false; return; }

    const r = judge(h1, h2);
    let p1hp = d.player1.hp;
    let p2hp = d.player2.hp;
    let text = "";

    if      (r === "p1win") { p2hp = Math.max(0, p2hp - 1); text = "YOU WIN !"; }
    else if (r === "p2win") { p1hp = Math.max(0, p1hp - 1); text = "ENEMY WIN !"; }
    else                    { text = "DRAW"; }

    const over = p1hp <= 0 || p2hp <= 0;
    if (p1hp <= 0) text = "YOU LOSE  --  GAME OVER";
    if (p2hp <= 0) text = "ENEMY LOSE  --  GAME OVER";

    log("判定:", h1, "vs", h2, "->", r, "|", text);

    roomRef.update({
        "player1/hp": p1hp, "player2/hp": p2hp,
        "player1/hand": h1, "player2/hand": h2,
        roundStatus: "result", resultText: text
    }).then(() => {
        if (over) {
            // ゲームオーバー → RETRYフラグをリセットして待機
            setTimeout(() => {
                if (!roomRef) { resolving = false; return; }
                roomRef.update({
                    "player1/hand": "", "player2/hand": "",
                    roundStatus: "gameover",
                    "retryRequest/player1": false,
                    "retryRequest/player2": false
                }).then(() => { resolving = false; });
            }, 2000);
            return;
        }
        // 次ラウンドへ
        setTimeout(() => {
            if (!roomRef) { resolving = false; return; }
            roomRef.update({
                "player1/hand": "", "player2/hand": "",
                roundStatus: "waiting", resultText: ""
            }).then(() => { resolving = false; });
        }, 3000);
    });
}

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
// RETRY ボタン
// ============================================================
function onClickRetry() {
    if (!roomRef || !myRole) return;
    document.getElementById("btn-retry").disabled = true;
    roomRef.child("retryRequest/" + myRole).set(true);
    log("RETRY要求:", myRole);
}

// 両者同意したらリセット（player1のみ実行）
function doRetry(d) {
    log("両者RETRY同意 → リセット");
    const p1c = d.player1 ? d.player1.charId : randCharId(null);
    const p2c = d.player2 ? d.player2.charId : randCharId(p1c);
    roomRef.update({
        "player1/hp": 3, "player1/hand": "", "player1/connected": true,
        "player2/hp": 3, "player2/hand": "", "player2/connected": true,
        "player1/charId": p1c, "player2/charId": p2c,
        roundStatus: "waiting",
        resultText: "",
        "retryRequest/player1": false,
        "retryRequest/player2": false
    });
}

// ============================================================
// チャット開始
// ============================================================
function startChat() {
    const roomId = document.getElementById("display-room-id").textContent;
    chatRef = db.ref("chats/" + roomId);

    chatRef.on("child_added", (snap) => {
        const msg = snap.val();
        if (!msg) return;
        // 初回ロード時は既存メッセージをスキップ（任意：表示したい場合は削除）
        appendChatMessage(msg);
    });
}

function sendChat() {
    const input = document.getElementById("chat-input");
    const text  = input.value.trim();
    if (!text || !chatRef) return;
    input.value = "";
    chatRef.push({ role: myRole, type: "text", body: text, ts: Date.now() });
}

function sendEmoji(emoId) {
    if (!chatRef) return;
    chatRef.push({ role: myRole, type: "emoji", body: emoId, ts: Date.now() });
}

function appendChatMessage(msg) {
    const log_el = document.getElementById("chat-log");
    const isMe   = msg.role === myRole;
    const div    = document.createElement("div");
    div.className = "chat-msg " + (isMe ? "chat-me" : "chat-enemy");

    if (msg.type === "emoji") {
        const img    = document.createElement("img");
        img.src      = msg.body + ".png";
        img.className = "chat-emoji-img";
        div.appendChild(img);
    } else {
        div.textContent = msg.body;
    }

    log_el.appendChild(div);
    log_el.scrollTop = log_el.scrollHeight;
}

// ============================================================
// UI描画
// ============================================================
function renderUI(d) {
    const p1   = d.player1;
    const p2   = d.player2;
    const p2on = !!(p2 && p2.connected);
    const status = d.roundStatus || "waiting";

    // ゲームオーバー判定
    gameOver = (status === "gameover");

    // HP
    renderHearts("p1-hp-row", p1 ? p1.hp : 0);
    if (p2on) {
        renderHearts("p2-hp-row", p2.hp);
    } else {
        document.getElementById("p2-hp-row").innerHTML =
            '<span class="hp-waiting">WAITING...</span>';
    }

    // 顔
    drawFace("face-canvas-p1", p1);
    drawFace("face-canvas-p2", p2on ? p2 : null);

    // バトルフィールド
    renderBattle(d);

    // RETRYボタン表示制御
    const retryWrap = document.getElementById("retry-wrap");
    const btnRetry  = document.getElementById("btn-retry");
    if (gameOver && p2on) {
        retryWrap.style.display = "flex";
        // 自分がすでにRETRY押していたらdisable
        const myRetry = d.retryRequest && d.retryRequest[myRole];
        btnRetry.disabled = !!myRetry;

        // 相手がRETRY待ちか表示
        const oppRole    = myRole === "player1" ? "player2" : "player1";
        const oppRetry   = d.retryRequest && d.retryRequest[oppRole];
        document.getElementById("retry-status").textContent =
            oppRetry ? "相手もRETRYを待っています..." : "";
    } else {
        retryWrap.style.display = "none";
    }

    // じゃんけんボタン：ゲームオーバー中・結果表示中は無効
    const handDisabled = gameOver || status === "result" || !p2on;
    ["btn-rock","btn-paper","btn-scissors"].forEach((id) => {
        document.getElementById(id).disabled = handDisabled;
    });
}

// ============================================================
// ハートHP表示
// ============================================================
function renderHearts(id, hp) {
    const el = document.getElementById(id);
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
// 顔スプライト描画
// ============================================================
function drawFace(canvasId, playerData) {
    const cvs = document.getElementById(canvasId);
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const dw  = cvs.width;
    const dh  = cvs.height;
    ctx.clearRect(0, 0, dw, dh);

    if (!playerData || playerData.charId == null) {
        ctx.fillStyle = "#111"; ctx.fillRect(0, 0, dw, dh);
        return;
    }

    const doRender = () => {
        const col = Math.max(0, Math.min(3, playerData.charId));
        const row = spriteRow(playerData.hp);
        ctx.drawImage(spriteImg,
            SP_COL_X[col], SP_ROW_Y[row], SP_COL_W[col], SP_ROW_H[row],
            0, 0, dw, dh);
    };

    if (spriteImg.complete && spriteImg.naturalWidth > 0) { doRender(); }
    else { spriteImg.onload = doRender; }
}

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

    html += '<div class="hand-cell"><span>YOU</span>';
    html += myHand
        ? '<img class="hand-img" src="' + handSrc(myHand) + '">'
        : '<div class="hand-placeholder">?</div>';
    html += '</div>';

    html += '<div class="vs-label">VS</div>';

    html += '<div class="hand-cell"><span>ENEMY</span>';
    if (status === "result" && oppHand) {
        html += '<img class="hand-img" src="' + handSrc(oppHand) + '">';
    } else if (status === "gameover" && oppHand) {
        html += '<img class="hand-img" src="' + handSrc(oppHand) + '">';
    } else if (oppHand) {
        html += '<div class="hand-placeholder">...</div>';
    } else {
        html += '<div class="hand-placeholder">?</div>';
    }
    html += '</div></div>';

    if (status === "result" || status === "gameover") {
        html += '<div class="result-text">' + (d.resultText || "") + '</div>';
    }

    el.innerHTML = html;
}

function handSrc(hand) {
    return { rock: "gu.png", paper: "pa.png", scissors: "choki.png" }[hand] || "";
}
