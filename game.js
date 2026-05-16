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
let roomRef             = null;
let myRole              = null;
let gameState           = null;
let isProcessingResult  = false;
let gameListenerActive  = false; // リスナー二重登録防止

const SPRITE_WIDTH  = 120;
const SPRITE_HEIGHT = 120;

// ==============================
// DOM取得（HTML読み込み後に確実に存在する）
// ==============================
const setupScreen   = document.getElementById("setup-screen");
const gameScreen    = document.getElementById("game-screen");
const displayRoomId = document.getElementById("display-room-id");
const inputRoomId   = document.getElementById("input-room-id");
const btnJoin       = document.getElementById("btn-join");
const p1Face        = document.getElementById("p1-face");
const p2Face        = document.getElementById("p2-face");
const p1HpDisplay   = document.getElementById("p1-hp");
const p2HpDisplay   = document.getElementById("p2-hp");
const canvas        = document.getElementById("gameCanvas");
const ctx           = canvas.getContext("2d");

// じゃんけんボタンはHTML側で一度だけ登録
document.getElementById("btn-rock")    .addEventListener("click", () => submitHand("rock"));
document.getElementById("btn-paper")   .addEventListener("click", () => submitHand("paper"));
document.getElementById("btn-scissors").addEventListener("click", () => submitHand("scissors"));

// ==============================
// 入室ボタン
// ==============================
btnJoin.addEventListener("click", enterRoom);
inputRoomId.addEventListener("keydown", (e) => { if (e.key === "Enter") enterRoom(); });

// ==============================
// 入室処理（ホスト自動判定）
// ==============================
function enterRoom() {
    const roomId = inputRoomId.value.trim();
    if (!/^\d{4}$/.test(roomId)) {
        alert("4桁の数字を入力してください。");
        return;
    }

    setJoinUIEnabled(false);
    roomRef = database.ref("rooms/" + roomId);

    roomRef.once("value")
        .then((snapshot) => {
            const data = snapshot.val();

            if (!data) {
                // ── 新規ルーム作成 → player1 ──
                myRole = "player1";
                const charId = Math.floor(Math.random() * 4);
                return roomRef.set({
                    player1:     { hp: 3, hand: "", connected: true,  charId: charId },
                    player2:     { hp: 3, hand: "", connected: false, charId: null   },
                    roundStatus: "waiting",
                    resultText:  ""
                });
            }

            if (!data.player1 || !data.player1.connected) {
                // ── player1の席が空き → player1として参加 ──
                myRole = "player1";
                const charId = Math.floor(Math.random() * 4);
                return roomRef.child("player1").update({
                    hp: data.player1 ? data.player1.hp : 3,
                    hand: "",
                    connected: true,
                    charId: charId
                });
            }

            if (!data.player2 || !data.player2.connected) {
                // ── player2の席が空き → player2として参加 ──
                myRole = "player2";
                const charId = Math.floor(Math.random() * 4);
                return roomRef.child("player2").update({
                    hp: data.player2 ? data.player2.hp : 3,
                    hand: "",
                    connected: true,
                    charId: charId
                });
            }

            // 満員
            throw new Error("FULL");
        })
        .then(() => {
            // Firebase書き込み完了後に画面遷移
            enterGameScreen(roomId);
            startListening();
        })
        .catch((err) => {
            if (err.message === "FULL") {
                alert("このルームは満員です。");
            } else {
                alert("エラー: " + err.message);
            }
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
// Firebaseリアルタイム監視（一度だけ登録）
// ==============================
function startListening() {
    if (gameListenerActive) return;
    gameListenerActive = true;

    roomRef.on("value", (snapshot) => {
        gameState = snapshot.val();
        if (!gameState) return;

        updateUI();
        renderGame();

        // player1だけが勝敗処理を担当
        if (
            myRole === "player1" &&
            !isProcessingResult &&
            gameState.roundStatus === "waiting" &&
            gameState.player1 && gameState.player1.hand &&
            gameState.player2 && gameState.player2.hand &&
            gameState.player2.connected
        ) {
            isProcessingResult = true;
            resolveRound();
        }
    });

    // 切断時にconnectedをfalseに
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
    if (!roomRef || !myRole || !gameState) return;
    if (gameState.roundStatus !== "waiting") return;

    const me = gameState[myRole];
    if (me && me.hand) return; // 既に選択済み
    if (!gameState.player2 || !gameState.player2.connected) return; // 相手未接続

    roomRef.child(myRole + "/hand").set(hand);
}

// ==============================
// 勝敗処理（player1のみ）
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

    const gameOver = (p1Hp <= 0 || p2Hp <= 0);
    if (p1Hp <= 0) resultText = "PLAYER 1 LOSE  —  GAME OVER";
    if (p2Hp <= 0) resultText = "PLAYER 2 LOSE  —  GAME OVER";

    roomRef.update({
        "player1/hp":   p1Hp,
        "player2/hp":   p2Hp,
        "player1/hand": p1Hand,
        "player2/hand": p2Hand,
        roundStatus:    "result",
        resultText:     resultText
    }).then(() => {
        if (gameOver) {
            isProcessingResult = false;
            return;
        }
        setTimeout(() => {
            roomRef.update({
                "player1/hand": "",
                "player2/hand": "",
                roundStatus:    "waiting",
                resultText:     ""
            }).then(() => {
                isProcessingResult = false;
            });
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
    const p1 = gameState.player1;
    const p2 = gameState.player2;

    if (p1) {
        p1HpDisplay.textContent = "HP: " + "❤️".repeat(Math.max(0, p1.hp));
        updatePlayerFace(p1Face, p1);
    }

    if (p2 && p2.connected) {
        p2HpDisplay.textContent = "HP: " + "❤️".repeat(Math.max(0, p2.hp));
        updatePlayerFace(p2Face, p2);
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

function updatePlayerFace(el, playerData) {
    if (!playerData || playerData.charId == null) return;
    const x = playerData.charId * SPRITE_WIDTH;
    const y = getSpriteRow(playerData.hp) * SPRITE_HEIGHT;
    el.style.backgroundImage    = "url('chara_set.png')";
    el.style.backgroundPosition = "-" + x + "px -" + y + "px";
    el.style.backgroundRepeat   = "no-repeat";
}

// ==============================
// Canvas描画
// ==============================
function renderGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // グリッド背景
    ctx.strokeStyle = "#000033";
    ctx.lineWidth   = 0.5;
    for (let i = 0; i < canvas.width;  i += 20) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
    }
    for (let j = 0; j < canvas.height; j += 20) {
        ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(canvas.width, j); ctx.stroke();
    }

    ctx.lineWidth   = 1;
    ctx.fillStyle   = "#ffffff";
    ctx.font        = "16px monospace";
    ctx.fillText("BATTLE FIELD", 10, 24);

    if (!gameState) return;

    const status      = gameState.roundStatus || "waiting";
    const p2Connected = gameState.player2 && gameState.player2.connected;

    if (!p2Connected) {
        ctx.fillStyle = "#00ffff";
        ctx.font      = "18px monospace";
        ctx.fillText("相手の参加を待っています...", 40, 150);
        return;
    }

    // 自分の手
    const myHand  = gameState[myRole]                                  ? gameState[myRole].hand  : "";
    const oppRole = myRole === "player1" ? "player2" : "player1";
    const oppHand = gameState[oppRole]                                 ? gameState[oppRole].hand  : "";

    ctx.font = "18px monospace";
    if (myHand) {
        ctx.fillStyle = "#00ff00";
        ctx.fillText("あなた: " + handToJa(myHand), 20, 80);
    } else {
        ctx.fillStyle = "#888888";
        ctx.fillText("手を選んでください...", 20, 80);
    }

    // 相手の手（結果時のみ公開）
    if (status === "result" && oppHand) {
        ctx.fillStyle = "#ff8800";
        ctx.fillText("相手: " + handToJa(oppHand), 20, 120);
    } else if (oppHand) {
        ctx.fillStyle = "#888888";
        ctx.fillText("相手: 選択済み ✔", 20, 120);
    }

    // 結果
    if (status === "result") {
        ctx.fillStyle = "#ffff00";
        ctx.font      = "bold 24px monospace";
        ctx.fillText(gameState.resultText || "", 20, 200);
    }
}

function handToJa(hand) {
    return { rock: "グー ✊", paper: "パー ✋", scissors: "チョキ ✌" }[hand] || hand;
}
