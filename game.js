// Firebaseの設定（ご自身のプロジェクト情報に書き換えてください）
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

let roomRef = null;
let myRole = null;
let gameState = null;

const SPRITE_WIDTH = 120;
const SPRITE_HEIGHT = 120;

// スプライトシートの行マッピング（HP 3→行0, HP 2→行1, HP 1→行2）
function getSpriteRow(hp) {
    if (hp >= 3) return 0;
    if (hp === 2) return 1;
    return 2; // hp <= 1
}

const setupScreen = document.getElementById("setup-screen");
const gameScreen = document.getElementById("game-screen");
const displayRoomId = document.getElementById("display-room-id");
const inputRoomId = document.getElementById("input-room-id");

const p1Face = document.getElementById("p1-face");
const p2Face = document.getElementById("p2-face");
const p1HpDisplay = document.getElementById("p1-hp");
const p2HpDisplay = document.getElementById("p2-hp");

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// イベントリスナー（「作成」ボタンは削除済み）
document.getElementById("btn-join").addEventListener("click", joinRoom);

// Enterキーでも参戦できるように
inputRoomId.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom();
});

function joinRoom() {
    const roomId = inputRoomId.value.trim();

    if (roomId.length !== 4) {
        alert("4桁のルームIDを入力してください。");
        return;
    }

    // 入力を無効化して二重送信を防ぐ
    inputRoomId.disabled = true;
    document.getElementById("btn-join").disabled = true;

    roomRef = database.ref("rooms/" + roomId);

    roomRef.once("value").then((snapshot) => {
        const roomData = snapshot.val();

        if (!roomData) {
            alert("ルームが見つかりません。");
            resetJoinUI();
            return;
        }

        // player1がいない部屋には参加できない
        if (!roomData.player1 || !roomData.player1.connected) {
            alert("ルームのホストが見つかりません。");
            resetJoinUI();
            return;
        }

        // player2がすでに接続済みか確認
        if (roomData.player2 && roomData.player2.connected) {
            alert("このルームは満員です。");
            resetJoinUI();
            return;
        }

        // player1として空き部屋に入るか、player2として参加するか判定
        // 自分がplayer1（部屋作成者）のケースはここでは想定しない（参戦専用）
        myRole = "player2";
        const myCharId = Math.floor(Math.random() * 4);

        roomRef.child("player2").set({
            hp: 3,
            hand: "",
            connected: true,
            charId: myCharId
        }).then(() => {
            enterGameScreen(roomId);
            initGame();
        }).catch((err) => {
            alert("参加に失敗しました: " + err.message);
            resetJoinUI();
        });

    }).catch((err) => {
        alert("接続エラー: " + err.message);
        resetJoinUI();
    });
}

function resetJoinUI() {
    inputRoomId.disabled = false;
    document.getElementById("btn-join").disabled = false;
}

function enterGameScreen(roomId) {
    setupScreen.style.display = "none";
    gameScreen.style.display = "block";
    displayRoomId.textContent = roomId;
}

function initGame() {
    roomRef.on("value", (snapshot) => {
        gameState = snapshot.val();
        if (!gameState) return;

        updateUI();
        renderGame();
    });

    // 切断処理
    window.addEventListener("beforeunload", () => {
        if (roomRef && myRole) {
            roomRef.child(`${myRole}/connected`).set(false);
        }
    });

    // じゃんけんボタン
    document.getElementById("btn-rock").addEventListener("click", () => submitHand("rock"));
    document.getElementById("btn-paper").addEventListener("click", () => submitHand("paper"));
    document.getElementById("btn-scissors").addEventListener("click", () => submitHand("scissors"));
}

function submitHand(hand) {
    if (!roomRef || !myRole) return;
    roomRef.child(`${myRole}/hand`).set(hand);
}

function updateUI() {
    // Player 1更新
    if (gameState.player1) {
        p1HpDisplay.textContent = `HP: ${gameState.player1.hp}`;
        updatePlayerFace(p1Face, gameState.player1);
    }
    // Player 2更新
    if (gameState.player2 && gameState.player2.connected) {
        p2HpDisplay.textContent = `HP: ${gameState.player2.hp}`;
        updatePlayerFace(p2Face, gameState.player2);
    } else {
        p2HpDisplay.textContent = "WAITING...";
        p2Face.style.backgroundImage = "none";
    }
}

function updatePlayerFace(element, playerData) {
    if (!playerData || playerData.charId === null || playerData.charId === undefined) return;

    const charId = playerData.charId;
    const hp = playerData.hp;

    // 横位置：キャラID × スプライト幅
    const xPosition = charId * SPRITE_WIDTH;
    // 縦位置：HPに応じた行（HP3→0行目, HP2→1行目, HP1→2行目）
    const yPosition = getSpriteRow(hp) * SPRITE_HEIGHT;

    element.style.backgroundImage = "url('chara_set.png')";
    element.style.backgroundPosition = `-${xPosition}px -${yPosition}px`;
    element.style.backgroundRepeat = "no-repeat";
}

function renderGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // PC-98風グリッド背景
    ctx.strokeStyle = "#000033";
    for (let i = 0; i < canvas.width; i += 20) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
    }
    for (let j = 0; j < canvas.height; j += 20) {
        ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(canvas.width, j); ctx.stroke();
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = "16px monospace";
    ctx.fillText("BATTLE FIELD", 10, 20);

    // 対戦状況の表示
    if (gameState) {
        const p1Hand = gameState.player1?.hand || "";
        const p2Hand = gameState.player2?.hand || "";
        const myHandLabel = myRole === "player1" ? p1Hand : p2Hand;

        if (myHandLabel) {
            ctx.fillStyle = "#00ff00";
            ctx.font = "14px monospace";
            ctx.fillText(`あなたの手: ${handToJa(myHandLabel)}`, 10, 50);
        }

        const roundStatus = gameState.roundStatus || "";
        if (roundStatus === "result") {
            ctx.fillStyle = "#ffff00";
            ctx.font = "20px monospace";
            ctx.fillText(gameState.resultText || "", 10, 100);
        }
    }
}

function handToJa(hand) {
    return { rock: "グー", paper: "パー", scissors: "チョキ" }[hand] || hand;
}
