// ==============================
// Firebase設定（自分のプロジェクト情報に書き換えてください）
// ==============================
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    databaseURL: "YOUR_DATABASE_URL",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ==============================
// 状態変数
// ==============================
let roomRef = null;
let myRole = null;   // "player1" or "player2"
let gameState = null;
let isProcessingResult = false; // 結果処理の二重実行防止

const SPRITE_WIDTH = 120;
const SPRITE_HEIGHT = 120;

// ==============================
// DOM取得
// ==============================
const setupScreen   = document.getElementById("setup-screen");
const gameScreen    = document.getElementById("game-screen");
const displayRoomId = document.getElementById("display-room-id");
const inputRoomId   = document.getElementById("input-room-id");
const btnJoin       = document.getElementById("btn-join");

const p1Face      = document.getElementById("p1-face");
const p2Face      = document.getElementById("p2-face");
const p1HpDisplay = document.getElementById("p1-hp");
const p2HpDisplay = document.getElementById("p2-hp");

const canvas = document.getElementById("gameCanvas");
const ctx    = canvas.getContext("2d");

// ==============================
// イベント登録
// ==============================
btnJoin.addEventListener("click", enterRoom);
inputRoomId.addEventListener("keydown", (e) => {
    if (e.key === "Enter") enterRoom();
});

// ==============================
// 入室処理（ホスト自動判定）
// ==============================
function enterRoom() {
    const roomId = inputRoomId.value.trim();
    if (roomId.length !== 4) {
        alert("4桁のルームIDを入力してください。");
        return;
    }

    setJoinUIEnabled(false);

    roomRef = database.ref("rooms/" + roomId);

    roomRef.once("value").then((snapshot) => {
        const roomData = snapshot.val();

        // ── ルームが存在しない → 自分がplayer1（ホスト）として作成 ──
        if (!roomData) {
            myRole = "player1";
            const myCharId = Math.floor(Math.random() * 4);
            return roomRef.set({
                player1: { hp: 3, hand: "", connected: true, charId: myCharId },
                player2: { hp: 3, hand: "", connected: false, charId: null },
                roundStatus: "waiting",
                resultText: ""
            }).then(() => {
                enterGameScreen(roomId);
                initGame();
            });
        }

        // ── player1の席が空いている → player1として入室 ──
        if (!roomData.player1 || !roomData.player1.connected) {
            myRole = "player1";
            const myCharId = Math.floor(Math.random() * 4);
            return roomRef.child("player1").set({
                hp: roomData.player1 ? roomData.player1.hp : 3,
                hand: "",
                connected: true,
                charId: myCharId
            }).then(() => {
                enterGameScreen(roomId);
                initGame();
            });
        }

        // ── player2の席が空いている → player2として入室 ──
        if (!roomData.player2 || !roomData.player2.connected) {
            myRole = "player2";
            const myCharId = Math.floor(Math.random() * 4);
            return roomRef.child("player2").set({
                hp: roomData.player2 ? roomData.player2.hp : 3,
                hand: "",
                connected: true,
                charId: myCharId
            }).then(() => {
                enterGameScreen(roomId);
                initGame();
            });
        }

        // ── 満員 ──
        alert("このルームは満員です。");
        setJoinUIEnabled(true);

    }).catch((err) => {
        alert("接続エラー: " + err.message);
        setJoinUIEnabled(true);
    });
}

function setJoinUIEnabled(enabled) {
    inputRoomId.disabled = !enabled;
    btnJoin.disabled     = !enabled;
}

function enterGameScreen(roomId) {
    setupScreen.style.display = "none";
    gameScreen.style.display  = "block";
    displayRoomId.textContent = roomId;
}

// ==============================
// ゲーム初期化
// ==============================
function initGame() {
    // Firebaseのリアルタイム監視
    roomRef.on("value", (snapshot) => {
        gameState = snapshot.val();
        if (!gameState) return;

        updateUI();
        renderGame();

        // 両者が手を出したらplayer1側で結果を処理
        if (
            myRole === "player1" &&
            gameState.roundStatus === "waiting" &&
            gameState.player1 && gameState.player1.hand &&
            gameState.player2 && gameState.player2.hand &&
            gameState.player2.connected &&
            !isProcessingResult
        ) {
            isProcessingResult = true;
            resolveRound();
        }
    });

    // じゃんけんボタン
    document.getElementById("btn-rock")    .addEventListener("click", () => submitHand("rock"));
    document.getElementById("btn-paper")   .addEventListener("click", () => submitHand("paper"));
    document.getElementById("btn-scissors").addEventListener("click", () => submitHand("scissors"));

    // 切断処理
    window.addEventListener("beforeunload", () => {
        if (roomRef && myRole) {
            roomRef.child(myRole + "/connected").set(false);
        }
    });
}

// ==============================
// 手を出す
// ==============================
function submitHand(hand) {
    if (!roomRef || !myRole) return;
    if (!gameState || gameState.roundStatus !== "waiting") return;

    const myHand = myRole === "player1"
        ? (gameState.player1 ? gameState.player1.hand : "")
        : (gameState.player2 ? gameState.player2.hand : "");
    if (myHand) return; // すでに手を出している

    roomRef.child(myRole + "/hand").set(hand);
}

// ==============================
// じゃんけん判定（player1のみ実行）
// ==============================
function resolveRound() {
    const p1Hand = gameState.player1.hand;
    const p2Hand = gameState.player2.hand;
    const result = judgeHand(p1Hand, p2Hand);

    let p1Hp = gameState.player1.hp;
    let p2Hp = gameState.player2.hp;
    let resultText = "";

    if (result === "p1win") {
        p2Hp = Math.max(0, p2Hp - 1);
        resultText = "PLAYER 1 の勝ち！";
    } else if (result === "p2win") {
        p1Hp = Math.max(0, p1Hp - 1);
        resultText = "PLAYER 2 の勝ち！";
    } else {
        resultText = "あいこ！";
    }

    if (p1Hp <= 0) resultText = "PLAYER 1 LOSE — GAME OVER";
    if (p2Hp <= 0) resultText = "PLAYER 2 LOSE — GAME OVER";

    roomRef.update({
        "player1/hp":   p1Hp,
        "player2/hp":   p2Hp,
        "player1/hand": p1Hand,
        "player2/hand": p2Hand,
        roundStatus:    "result",
        resultText:     resultText
    }).then(() => {
        setTimeout(() => {
            if (p1Hp > 0 && p2Hp > 0) {
                roomRef.update({
                    "player1/hand": "",
                    "player2/hand": "",
                    roundStatus:    "waiting",
                    resultText:     ""
                }).then(() => {
                    isProcessingResult = false;
                });
            } else {
                isProcessingResult = false;
            }
        }, 3000);
    });
}

function judgeHand(h1, h2) {
    if (h1 === h2) return "draw";
    if (
        (h1 === "rock"     && h2 === "scissors") ||
        (h1 === "scissors" && h2 === "paper")    ||
        (h1 === "paper"    && h2 === "rock")
    ) return "p1win";
    return "p2win";
}

// ==============================
// UI更新
// ==============================
function updateUI() {
    if (gameState.player1) {
        var p1Hp = Math.max(0, gameState.player1.hp);
        p1HpDisplay.textContent = "HP: " + "❤️".repeat(p1Hp);
        updatePlayerFace(p1Face, gameState.player1);
    }

    if (gameState.player2 && gameState.player2.connected) {
        var p2Hp = Math.max(0, gameState.player2.hp);
        p2HpDisplay.textContent = "HP: " + "❤️".repeat(p2Hp);
        updatePlayerFace(p2Face, gameState.player2);
    } else {
        p2HpDisplay.textContent = "WAITING...";
        p2Face.style.backgroundImage = "none";
    }
}

function getSpriteRow(hp) {
    if (hp >= 3) return 0;
    if (hp === 2) return 1;
    return 2;
}

function updatePlayerFace(element, playerData) {
    if (!playerData || playerData.charId === null || playerData.charId === undefined) return;

    var xPosition = playerData.charId * SPRITE_WIDTH;
    var yPosition = getSpriteRow(playerData.hp) * SPRITE_HEIGHT;

    element.style.backgroundImage    = "url('chara_set.png')";
    element.style.backgroundPosition = "-" + xPosition + "px -" + yPosition + "px";
    element.style.backgroundRepeat   = "no-repeat";
}

// ==============================
// Canvas描画
// ==============================
function renderGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // グリッド背景
    ctx.strokeStyle = "#000033";
    ctx.lineWidth = 0.5;
    for (var i = 0; i < canvas.width; i += 20) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
    }
    for (var j = 0; j < canvas.height; j += 20) {
        ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(canvas.width, j); ctx.stroke();
    }

    ctx.lineWidth = 1;
    ctx.fillStyle = "#ffffff";
    ctx.font = "16px monospace";
    ctx.fillText("BATTLE FIELD", 10, 24);

    if (!gameState) return;

    var roundStatus = gameState.roundStatus || "waiting";
    var p2Connected = gameState.player2 && gameState.player2.connected;

    // 相手待ち
    if (!p2Connected) {
        ctx.fillStyle = "#00ffff";
        ctx.font = "18px monospace";
        ctx.fillText("相手の参加を待っています...", 40, 150);
        return;
    }

    // 自分の手
    var myHand = myRole === "player1"
        ? (gameState.player1 ? gameState.player1.hand : "")
        : (gameState.player2 ? gameState.player2.hand : "");

    if (myHand) {
        ctx.fillStyle = "#00ff00";
        ctx.font = "18px monospace";
        ctx.fillText("あなた: " + handToJa(myHand), 20, 80);
    } else {
        ctx.fillStyle = "#888888";
        ctx.font = "18px monospace";
        ctx.fillText("手を選んでください...", 20, 80);
    }

    // 相手の手（結果表示時のみ公開）
    var oppHand = myRole === "player1"
        ? (gameState.player2 ? gameState.player2.hand : "")
        : (gameState.player1 ? gameState.player1.hand : "");

    if (roundStatus === "result" && oppHand) {
        ctx.fillStyle = "#ff8800";
        ctx.font = "18px monospace";
        ctx.fillText("相手: " + handToJa(oppHand), 20, 120);
    } else if (oppHand) {
        ctx.fillStyle = "#888888";
        ctx.font = "18px monospace";
        ctx.fillText("相手: 選択済み ✔", 20, 120);
    }

    // 結果表示
    if (roundStatus === "result") {
        ctx.fillStyle = "#ffff00";
        ctx.font = "bold 24px monospace";
        ctx.fillText(gameState.resultText || "", 20, 200);
    }
}

function handToJa(hand) {
    var map = { rock: "グー ✊", paper: "パー ✋", scissors: "チョキ ✌" };
    return map[hand] || hand;
}
