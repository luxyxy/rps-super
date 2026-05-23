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
const db   = firebase.database();
const auth = firebase.auth();

// ============================================================
// スプライト座標
// ============================================================
const SP_COL_X = [4,   279, 554, 829];
const SP_COL_W = [270, 275, 270, 267];
const SP_ROW_Y = [4,   300, 605];
const SP_ROW_H = [291, 300, 252];
const DISP_W   = 150;
const DISP_H   = 176;

const spriteImg = new Image(); spriteImg.src = "chara_set.png";
const imgH1     = new Image(); imgH1.src     = "heart1.png";
const imgH2     = new Image(); imgH2.src     = "heart2.png";

// ============================================================
// グローバル状態
// ============================================================
let myRole        = null;   // "player1" | "player2"  ← DBから確定後にセット
let mySessionKey  = null;   // このブラウザ固有のキー
let currentRoomId = null;
let roomRef       = null;
let chatRef       = null;
let resolving     = false;
let gameOver      = false;
let chatListener  = null;

function log(...a) { console.log("[RPS]", ...a); }

// ============================================================
// ボタン登録
// ============================================================
document.getElementById("btn-join")     .onclick   = onClickEnter;
document.getElementById("input-room-id").onkeydown = (e) => { if (e.key === "Enter") onClickEnter(); };
document.getElementById("btn-rock")     .onclick   = () => submitHand("rock");
document.getElementById("btn-paper")    .onclick   = () => submitHand("paper");
document.getElementById("btn-scissors") .onclick   = () => submitHand("scissors");
document.getElementById("btn-retry")    .onclick   = onClickRetry;
document.getElementById("btn-end")      .onclick   = onClickEnd;
document.getElementById("btn-send")     .onclick   = sendChat;
document.getElementById("chat-input")   .onkeydown = (e) => { if (e.key === "Enter") sendChat(); };
["emo1","emo2","emo3","emo4"].forEach((id) => {
    document.getElementById("btn-" + id).onclick = () => sendEmoji(id);
});

// ============================================================
// 匿名認証
// ============================================================
document.getElementById("btn-join").disabled = true;

auth.signInAnonymously().catch((err) => {
    log("認証失敗:", err.message);
    alert("認証エラー: " + err.message);
});

auth.onAuthStateChanged((user) => {
    if (user) {
        // 認証UIDをセッションキーとして使用（ブラウザごとに必ず一意）
        mySessionKey = user.uid;
        log("認証完了 key:", mySessionKey);
        document.getElementById("btn-join").disabled = false;
    }
});

// ============================================================
// 全データ削除
// ============================================================
function deleteAllRoomData(roomId) {
    if (!roomId) return Promise.resolve();
    log("全削除:", roomId);
    return Promise.all([
        db.ref("rooms/"  + roomId).remove(),
        db.ref("chats/"  + roomId).remove()
    ]);
}

// ============================================================
// ENTER ボタン処理
//
// 方針：
//   rooms/{roomId}/p1key, p2key にセッションキーを書き込む。
//   「自分のキーがp1keyに書かれていたら自分はplayer1」と判定。
//   書き込みはFirebase runTransaction で先着順を保証。
//   p1key が空 → player1として書き込み
//   p1key が埋まっていて p2key が空 → player2として書き込み
//   両方埋まっている → 満員
// ============================================================
function onClickEnter() {
    const roomId = document.getElementById("input-room-id").value.trim();
    if (!/^\d{4}$/.test(roomId)) { alert("4桁の数字を入力してください。"); return; }
    if (!mySessionKey) { alert("認証中です。少し待ってください。"); return; }

    document.getElementById("btn-join").disabled      = true;
    document.getElementById("input-room-id").disabled = true;

    const keysRef = db.ref("rooms/" + roomId + "/keys");

    // p1key への先着書き込みを試みる
    keysRef.child("p1key").transaction((cur) => {
        // cur が null（未存在）または空文字のときだけ自分のキーを書く
        if (cur === null || cur === "") return mySessionKey;
        // すでに自分のキーが入っている（リロード等）→ そのまま継続
        if (cur === mySessionKey) return mySessionKey;
        return undefined; // 他人が入っている → アボート
    }).then((res1) => {
        if (res1.committed) {
            // p1key に書けた → player1確定
            myRole = "player1";
            log("player1確定");
            return initializeRoom(roomId);
        }

        // p1keyに他人がいる → p2keyを試みる
        return keysRef.child("p2key").transaction((cur) => {
            if (cur === null || cur === "") return mySessionKey;
            if (cur === mySessionKey) return mySessionKey;
            return undefined;
        }).then((res2) => {
            if (res2.committed) {
                myRole = "player2";
                log("player2確定");
                return joinAsPlayer2(roomId);
            }
            throw new Error("FULL");
        });
    }).then(() => {
        currentRoomId = roomId;
        roomRef = db.ref("rooms/" + roomId);
        showGameScreen(roomId);
        startWatching();
        startChat(roomId);
    }).catch((err) => {
        log("エラー:", err.message);
        alert(err.message === "FULL" ? "このルームは満員です。" : "エラー: " + err.message);
        document.getElementById("btn-join").disabled      = false;
        document.getElementById("input-room-id").disabled = false;
    });
}

// player1として部屋を初期化
// keys ノードは残したまま、ゲームデータだけ書き込む
function initializeRoom(roomId) {
    const charId = randCharId(null);
    return db.ref("rooms/" + roomId).update({
        player1: { hp: 3, hand: "", connected: true,  charId: charId },
        player2: { hp: 3, hand: "", connected: false, charId: null   },
        roundStatus:  "waiting",
        resultText:   "",
        retryRequest: { player1: false, player2: false }
        // keys は上書きしない（transactionで書いたp1keyを保持）
    });
}

// player2として参加
function joinAsPlayer2(roomId) {
    return db.ref("rooms/" + roomId + "/player1").once("value").then((snap) => {
        const p1data   = snap.val();
        const p1charId = p1data ? p1data.charId : null;
        return db.ref("rooms/" + roomId + "/player2").update({
            hp: 3, hand: "", connected: true, charId: randCharId(p1charId)
        });
    });
}

function randCharId(excludeId) {
    const ids = [0, 1, 2, 3].filter((id) => id !== excludeId);
    return ids[Math.floor(Math.random() * ids.length)];
}

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
}

// ============================================================
// タイトルへ戻る
// ============================================================
function backToTitle() {
    if (roomRef)  { roomRef.off(); roomRef = null; }
    if (chatRef && chatListener) {
        chatRef.off("child_added", chatListener);
        chatListener = null;
        chatRef = null;
    }

    myRole        = null;
    currentRoomId = null;
    resolving     = false;
    gameOver      = false;

    document.getElementById("chat-log").innerHTML     = "";
    document.getElementById("input-room-id").value    = "";
    document.getElementById("input-room-id").disabled = false;
    document.getElementById("btn-join").disabled      = false;
    document.getElementById("retry-wrap").style.display = "none";
    document.getElementById("retry-status").textContent = "";

    document.getElementById("game-screen").style.display  = "none";
    document.getElementById("setup-screen").style.display = "flex";
}

// ENDボタン
function onClickEnd() {
    const roomId = currentRoomId;
    backToTitle();
    if (roomId) deleteAllRoomData(roomId);
}

// ============================================================
// Firebase リアルタイム監視
// ============================================================
function startWatching() {
    log("監視開始 role=", myRole, "key=", mySessionKey);

    roomRef.on("value", (snap) => {
        const d = snap.val();
        if (!d) return;

        // ★ keys を見て自分のロールを毎回確認（ズレを防ぐ）
        const keys = d.keys || {};
        if (keys.p1key === mySessionKey) {
            myRole = "player1";
        } else if (keys.p2key === mySessionKey) {
            myRole = "player2";
        }
        // myRole が確定してから描画
        if (!myRole) return;

        renderUI(d);

        const p1hand = d.player1 && d.player1.hand;
        const p2hand = d.player2 && d.player2.hand;
        if (
            myRole === "player1"        &&
            !resolving                  &&
            d.roundStatus === "waiting" &&
            p1hand && p1hand !== ""     &&
            p2hand && p2hand !== ""     &&
            d.player2 && d.player2.connected
        ) {
            resolveRound(d);
        }

        if (
            myRole === "player1"            &&
            gameOver                        &&
            d.retryRequest                  &&
            d.retryRequest.player1 === true &&
            d.retryRequest.player2 === true
        ) {
            doRetry(d);
        }
    });

    window.addEventListener("beforeunload", () => {
        if (currentRoomId) deleteAllRoomData(currentRoomId);
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
        if (d.roundStatus !== "waiting")              return;
        const myHand = d[myRole] && d[myRole].hand;
        if (myHand && myHand !== "")                  return;
        if (!d.player2 || !d.player2.connected)       return;
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

    const h1    = d.player1.hand;
    const h2    = d.player2.hand;
    const valid = ["rock", "paper", "scissors"];
    if (!valid.includes(h1) || !valid.includes(h2)) { resolving = false; return; }

    const r  = judge(h1, h2);
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
        "player1/hp":   p1hp, "player2/hp":   p2hp,
        "player1/hand": h1,   "player2/hand": h2,
        roundStatus: "result", resultText: text
    }).then(() => {
        if (over) {
            setTimeout(() => {
                if (!roomRef) { resolving = false; return; }
                roomRef.update({
                    "player1/hand": "", "player2/hand": "",
                    roundStatus: "gameover",
                    "retryRequest/player1": false,
                    "retryRequest/player2": false
                }).then(() => { resolving = false; });
            }, 2000);
        } else {
            setTimeout(() => {
                if (!roomRef) { resolving = false; return; }
                roomRef.update({
                    "player1/hand": "", "player2/hand": "",
                    roundStatus: "waiting", resultText: ""
                }).then(() => { resolving = false; });
            }, 3000);
        }
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
// RETRY
// ============================================================
function onClickRetry() {
    if (!roomRef || !myRole) return;
    document.getElementById("btn-retry").disabled = true;
    roomRef.child("retryRequest/" + myRole).set(true);
}

function doRetry(d) {
    log("両者RETRY同意 → リセット");
    if (!currentRoomId) return;
    const p1c = d.player1 ? d.player1.charId : randCharId(null);
    const p2c = d.player2 ? d.player2.charId : randCharId(p1c);

    // チャットリセット
    db.ref("chats/" + currentRoomId).remove().then(() => {
        document.getElementById("chat-log").innerHTML = "";
        startChat(currentRoomId);
    });

    roomRef.update({
        "player1/hp": 3, "player1/hand": "",
        "player2/hp": 3, "player2/hand": "",
        "player1/charId": p1c, "player2/charId": p2c,
        roundStatus: "waiting", resultText: "",
        "retryRequest/player1": false,
        "retryRequest/player2": false
    });
}

// ============================================================
// チャット
// ============================================================
function startChat(roomId) {
    const ref = db.ref("chats/" + roomId);
    chatRef = ref;
    if (chatListener) { ref.off("child_added", chatListener); chatListener = null; }

    let initialized = false;
    ref.once("value", () => { initialized = true; });

    chatListener = ref.on("child_added", (snap) => {
        if (!initialized) return;
        const msg = snap.val();
        if (msg) appendChatMessage(msg);
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
    const logEl = document.getElementById("chat-log");
    const isMe  = (msg.role === myRole);
    const div   = document.createElement("div");
    div.className = "chat-msg " + (isMe ? "chat-me" : "chat-enemy");
    if (msg.type === "emoji") {
        const img = document.createElement("img");
        img.src       = msg.body + ".png";
        img.className = "chat-emoji-img";
        div.appendChild(img);
    } else {
        div.textContent = msg.body;
    }
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
}

// ============================================================
// UI描画
// ============================================================
function renderUI(d) {
    if (!myRole) return;
    const oppRole = myRole === "player1" ? "player2" : "player1";
    const myData  = d[myRole]  || null;
    const oppData = d[oppRole] || null;
    const oppOn   = !!(oppData && oppData.connected);
    const status  = d.roundStatus || "waiting";

    gameOver = (status === "gameover");

    // HP（左=自分=YOU、右=相手=ENEMY）
    renderHearts("p1-hp-row", myData ? myData.hp : 0);
    if (oppOn) {
        renderHearts("p2-hp-row", oppData.hp);
    } else {
        document.getElementById("p2-hp-row").innerHTML =
            '<span class="hp-waiting">WAITING...</span>';
    }

    // 顔（左=自分、右=相手）
    drawFace("face-canvas-p1", myData);
    drawFace("face-canvas-p2", oppOn ? oppData : null);

    renderBattle(d);

    // RETRYエリア
    const retryWrap = document.getElementById("retry-wrap");
    if (gameOver) {
        retryWrap.style.display = "flex";
        const myRetry  = d.retryRequest && d.retryRequest[myRole];
        document.getElementById("btn-retry").disabled = !!myRetry;
        const oppRetry = d.retryRequest && d.retryRequest[oppRole];
        document.getElementById("retry-status").textContent =
            (oppOn && oppRetry) ? "相手もRETRYを待っています..." : "";
    } else {
        retryWrap.style.display = "none";
    }

    const handDisabled = gameOver || status === "result" || !oppOn;
    ["btn-rock","btn-paper","btn-scissors"].forEach((id) => {
        document.getElementById(id).disabled = handDisabled;
    });
}

// ============================================================
// ハートHP
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
// バトルフィールド
// ============================================================
function renderBattle(d) {
    const el      = document.getElementById("battle-text");
    if (!myRole) return;
    const oppRole = myRole === "player1" ? "player2" : "player1";
    const oppData = d[oppRole] || null;
    const oppOn   = !!(oppData && oppData.connected);
    const status  = d.roundStatus || "waiting";

    if (!oppOn) {
        el.innerHTML = '<span style="color:#00ffff;">相手の参加を待っています...</span>';
        return;
    }

    const myHand  = d[myRole] ? d[myRole].hand : "";
    const oppHand = oppData   ? oppData.hand    : "";
    const reveal  = status === "result" || status === "gameover";

    let html = '<div class="hand-row">';
    html += '<div class="hand-cell"><span>YOU</span>';
    html += myHand
        ? '<img class="hand-img" src="' + handSrc(myHand) + '">'
        : '<div class="hand-placeholder">?</div>';
    html += '</div><div class="vs-label">VS</div>';
    html += '<div class="hand-cell"><span>ENEMY</span>';
    if (reveal && oppHand) {
        html += '<img class="hand-img" src="' + handSrc(oppHand) + '">';
    } else if (oppHand) {
        html += '<div class="hand-placeholder">...</div>';
    } else {
        html += '<div class="hand-placeholder">?</div>';
    }
    html += '</div></div>';

    if (reveal) {
        const raw = d.resultText || "";
        let text  = raw;
        // player2視点では WIN/LOSE が逆になる
        if (myRole === "player2") {
            if      (raw === "YOU WIN !")                 text = "ENEMY WIN !";
            else if (raw === "ENEMY WIN !")               text = "YOU WIN !";
            else if (raw === "YOU LOSE  --  GAME OVER")   text = "ENEMY LOSE  --  GAME OVER";
            else if (raw === "ENEMY LOSE  --  GAME OVER") text = "YOU LOSE  --  GAME OVER";
        }
        html += '<div class="result-text">' + text + '</div>';
    }
    el.innerHTML = html;
}

function handSrc(hand) {
    return { rock: "gu.png", paper: "pa.png", scissors: "choki.png" }[hand] || "";
}
