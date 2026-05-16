// ============================================================
// Firebase設定（自分のプロジェクト情報に書き換えてください）
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
// グローバル変数
// ============================================================
let myRole  = null;   // "player1" | "player2"
let roomRef = null;

const SPRITE_W = 120;
const SPRITE_H = 120;

// ============================================================
// 起動時：ボタンだけ登録
// ============================================================
document.getElementById("btn-join").onclick = onClickEnter;
document.getElementById("input-room-id").onkeydown = (e) => { if (e.key === "Enter") onClickEnter(); };

// ============================================================
// ENTER ボタン処理
// ============================================================
function onClickEnter() {
    const roomId = document.getElementById("input-room-id").value.trim();
    if (!/^\d{4}$/.test(roomId)) {
        alert("4桁の数字を入力してください。");
        return;
    }

    document.getElementById("btn-join").disabled = true;
    document.getElementById("input-room-id").disabled = true;

    const ref = db.ref("rooms/" + roomId);

    ref.once("value").then((snap) => {
        const data = snap.val();
        log("取得したルームデータ:", data);

        if (!data) {
            // ルームなし → 自分がplayer1として作成
            myRole  = "player1";
            roomRef = ref;
            const charId = rand4();
            return ref.set({
                player1:     { hp: 3, hand: "", connected: true,  charId },
                player2:     { hp: 3, hand: "", connected: false, charId: null },
                roundStatus: "waiting",
                resultText:  ""
            });
        }

        // ルームあり
        const p1ok = data.player1 && data.player1.connected;
        const p2ok = data.player2 && data.player2.connected;

        if (!p1ok) {
            myRole  = "player1";
            roomRef = ref;
            return ref.child("player1").update({ connected: true, hand: "", charId: rand4() });
        }
        if (!p2ok) {
            myRole  = "player2";
            roomRef = ref;
            return ref.child("player2").update({ connected: true, hand: "", charId: rand4() });
        }

        throw new Error("FULL");

    }).then(() => {
        log("書き込み成功。role =", myRole);
        showGameScreen(document.getElementById("input-room-id").value.trim());
        startWatching();

    }).catch((err) => {
        log("エラー:", err.message);
        alert(err.message === "FULL" ? "このルームは満員です。" : "エラー: " + err.message);
        document.getElementById("btn-join").disabled = false;
        document.getElementById("input-room-id").disabled = false;
    });
}

function rand4() { return Math.floor(Math.random() * 4); }

function log(...args) { console.log("[RPS]", ...args); }

// ============================================================
// ゲーム画面へ切り替え
// ============================================================
function showGameScreen(roomId) {
    document.getElementById("setup-screen").style.display = "none";
    document.getElementById("game-screen").style.display  = "block";
    document.getElementById("display-room-id").textContent = roomId;
    log("ゲーム画面に切り替えました");
}

// ============================================================
// じゃんけんボタン（game-screen内）
// ============================================================
document.getElementById("btn-rock")    .onclick = () => submitHand("rock");
document.getElementById("btn-paper")   .onclick = () => submitHand("paper");
document.getElementById("btn-scissors").onclick = () => submitHand("scissors");

function submitHand(hand) {
    if (!roomRef || !myRole) { log("未接続"); return; }

    roomRef.once("value").then((snap) => {
        const d = snap.val();
        if (!d) return;
        if (d.roundStatus !== "waiting") { log("結果表示中のため無効"); return; }
        if (d[myRole] && d[myRole].hand) { log("すでに選択済み"); return; }
        if (!d.player2 || !d.player2.connected) { log("相手未接続"); return; }

        log("手を出す:", hand);
        roomRef.child(myRole + "/hand").set(hand);
    });
}

// ============================================================
// Firebaseリアルタイム監視
// ============================================================
function startWatching() {
    log("監視開始");
    roomRef.on("value", (snap) => {
        const d = snap.val();
        if (!d) return;

        renderUI(d);

        // player1だけが勝敗処理を実行
        if (
            myRole === "player1"          &&
            d.roundStatus === "waiting"   &&
            d.player1 && d.player1.hand   &&
            d.player2 && d.player2.hand   &&
            d.player2.connected
        ) {
            resolveRound(d);
        }
    });

    window.addEventListener("beforeunload", () => {
        if (roomRef && myRole) roomRef.child(myRole + "/connected").set(false);
    });
}

// ============================================================
// 勝敗処理（player1のみ）
// ============================================================
let resolving = false;

function resolveRound(d) {
    if (resolving) return;
    resolving = true;

    const h1 = d.player1.hand;
    const h2 = d.player2.hand;
    const r  = judge(h1, h2);

    let p1hp = d.player1.hp;
    let p2hp = d.player2.hp;
    let text = "";

    if (r === "p1win") { p2hp = Math.max(0, p2hp - 1); text = "PLAYER 1 の勝ち！"; }
    else if (r === "p2win") { p1hp = Math.max(0, p1hp - 1); text = "PLAYER 2 の勝ち！"; }
    else { text = "あいこ！"; }

    const over = p1hp <= 0 || p2hp <= 0;
    if (p1hp <= 0) text = "PLAYER 1 LOSE — GAME OVER";
    if (p2hp <= 0) text = "PLAYER 2 LOSE — GAME OVER";

    log("判定:", h1, "vs", h2, "→", r, text);

    roomRef.update({
        "player1/hp": p1hp, "player2/hp": p2hp,
        "player1/hand": h1, "player2/hand": h2,
        roundStatus: "result", resultText: text
    }).then(() => {
        if (over) { resolving = false; return; }
        setTimeout(() => {
            roomRef.update({
                "player1/hand": "", "player2/hand": "",
                roundStatus: "waiting", resultText: ""
            }).then(() => { resolving = false; });
        }, 3000);
    });
}

function judge(h1, h2) {
    if (h1 === h2) return "draw";
    if ((h1==="rock"&&h2==="scissors")||(h1==="scissors"&&h2==="paper")||(h1==="paper"&&h2==="rock")) return "p1win";
    return "p2win";
}

// ============================================================
// UI描画
// ============================================================
function renderUI(d) {
    const p1 = d.player1;
    const p2 = d.player2;

    // HP
    document.getElementById("p1-hp").textContent =
        p1 ? "HP: " + "❤️".repeat(Math.max(0, p1.hp)) : "HP: ---";
    document.getElementById("p2-hp").textContent =
        (p2 && p2.connected) ? "HP: " + "❤️".repeat(Math.max(0, p2.hp)) : "WAITING...";

    // 顔スプライト
    setFace("p1-face", p1);
    setFace("p2-face", (p2 && p2.connected) ? p2 : null);

    // Canvas
    renderCanvas(d);
}

function setFace(id, playerData) {
    const el = document.getElementById(id);
    if (!playerData || playerData.charId == null) {
        el.style.backgroundImage = "none";
        return;
    }
    const x = playerData.charId * SPRITE_W;
    const y = spriteRow(playerData.hp) * SPRITE_H;
    el.style.backgroundImage    = "url('chara_set.png')";
    el.style.backgroundPosition = `-${x}px -${y}px`;
    el.style.backgroundRepeat   = "no-repeat";
}

function spriteRow(hp) {
    if (hp >= 3) return 0;
    if (hp === 2) return 1;
    return 2;
}

// ============================================================
// Canvas描画
// ============================================================
const canvas = document.getElementById("gameCanvas");
const ctx    = canvas.getContext("2d");

function renderCanvas(d) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // グリッド
    ctx.strokeStyle = "#000033";
    ctx.lineWidth   = 0.5;
    for (let i = 0; i < canvas.width;  i += 20) { ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,canvas.height); ctx.stroke(); }
    for (let j = 0; j < canvas.height; j += 20) { ctx.beginPath(); ctx.moveTo(0,j); ctx.lineTo(canvas.width,j);  ctx.stroke(); }

    ctx.lineWidth = 1;
    ctx.fillStyle = "#ffffff";
    ctx.font      = "16px monospace";
    ctx.fillText("BATTLE FIELD", 10, 24);

    const p2on = d.player2 && d.player2.connected;

    if (!p2on) {
        ctx.fillStyle = "#00ffff";
        ctx.font      = "18px monospace";
        ctx.fillText("相手の参加を待っています...", 30, 160);
        return;
    }

    const status  = d.roundStatus || "waiting";
    const myHand  = d[myRole] ? d[myRole].hand : "";
    const oppRole = myRole === "player1" ? "player2" : "player1";
    const oppHand = d[oppRole] ? d[oppRole].hand : "";

    ctx.font = "18px monospace";

    if (myHand) {
        ctx.fillStyle = "#00ff00";
        ctx.fillText("あなた: " + ja(myHand), 20, 80);
    } else {
        ctx.fillStyle = "#888888";
        ctx.fillText("手を選んでください...", 20, 80);
    }

    if (status === "result" && oppHand) {
        ctx.fillStyle = "#ff8800";
        ctx.fillText("相手: " + ja(oppHand), 20, 120);
    } else if (oppHand) {
        ctx.fillStyle = "#888888";
        ctx.fillText("相手: 選択済み ✔", 20, 120);
    }

    if (status === "result") {
        ctx.fillStyle = "#ffff00";
        ctx.font      = "bold 22px monospace";
        ctx.fillText(d.resultText || "", 20, 200);
    }
}

function ja(h) { return {rock:"グー ✊", paper:"パー ✋", scissors:"チョキ ✌"}[h] || h; }
