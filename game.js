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

// イベントリスナー
document.getElementById("btn-create").addEventListener("click", createRoom);
document.getElementById("btn-join").addEventListener("click", joinRoom);

function generateRoomId() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function createRoom() {
    const roomId = generateRoomId();
    roomRef = database.ref("rooms/" + roomId);
    myRole = "player1";

    const myCharId = Math.floor(Math.random() * 4); // 0〜3のキャラID

    const initialData = {
        player1: { hp: 3, hand: "", connected: true, charId: myCharId },
        player2: { hp: 3, hand: "", connected: false, charId: null },
        roundStatus: "waiting"
    };

    roomRef.set(initialData).then(() => {
        enterGameScreen(roomId);
        initGame();
    });
}

function joinRoom() {
    const roomId = inputRoomId.value.trim();
    if (roomId.length !== 4) {
        alert("4桁のルームIDを入力してください。");
        return;
    }

    roomRef = database.ref("rooms/" + roomId);
    myRole = "player2";

    roomRef.once("value").then((snapshot) => {
        const roomData = snapshot.val();
        if (!roomData) {
            alert("ルームが見つかりません。");
            return;
        }
        if (roomData.player2 && roomData.player2.connected) {
            alert("このルームは満員です。");
            return;
        }

        const myCharId = Math.floor(Math.random() * 4);

        roomRef.child("player2").set({
            hp: 3,
            hand: "",
            connected: true,
            charId: myCharId
        }).then(() => {
            enterGameScreen(roomId);
            initGame();
        });
    });
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
        // 相手がいないときは背景を消す
        p2Face.style.backgroundImage = "none";
    }
}

function updatePlayerFace(element, playerData) {
    if (!playerData || playerData.charId === null || playerData.charId === undefined) return;

    element.style.backgroundImage = "url('chara_set.png')";
    const charId = playerData.charId; 
    const hp = playerData.hp;

    // キャラクターごとの横位置 (0〜3)
    const xPosition = charId * SPRITE_WIDTH;
    // HPが1のときだけ、スプライトの2段目（泣き顔）を表示する
    const yPosition = (hp === 1) ? SPRITE_HEIGHT : 0;

    element.style.backgroundPosition = `-${xPosition}px -${yPosition}px`;
}

// 簡易的な物理・演出描画（物理同期が必要な場合はここにgameStateの座標を反映）
function renderGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // PC-98風グリッド背景（演出）
    ctx.strokeStyle = "#000033";
    for(let i=0; i<canvas.width; i+=20) {
        ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,canvas.height); ctx.stroke();
    }
    for(let j=0; j<canvas.height; j+=20) {
        ctx.beginPath(); ctx.moveTo(0,j); ctx.lineTo(canvas.width,j); ctx.stroke();
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = "16px monospace";
    ctx.fillText("BATTLE FIELD", 10, 20);
}