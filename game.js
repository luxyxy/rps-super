// Firebaseの初期化
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
const database = firebase.database();

// グローバル変数
let roomId = "";
let myRole = ""; 
let oppRole = ""; 
let roomRef = null;
let gameState = null;
let isProcessingRound = false; // 連打・重複判定防止フラグ

// DOM要素
const lobbyScreen = document.getElementById("lobby");
const gameScreen = document.getElementById("game-screen");
const roomInput = document.getElementById("room-input");
const joinBtn = document.getElementById("join-btn");
const messageOverlay = document.getElementById("message-overlay");

const myHpContainer = document.getElementById("my-hp");
const oppHpContainer = document.getElementById("opp-hp");
const myFace = document.getElementById("my-face");
const oppFace = document.getElementById("opp-face");
const myHandBox = document.getElementById("my-hand-box");
const oppHandBox = document.getElementById("opp-hand-box");

const handButtons = document.querySelectorAll(".hand-btn");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");

// ルーム参加イベント
joinBtn.addEventListener("click", () => {
    const inputVal = roomInput.value.trim();
    if (inputVal.length !== 4 || isNaN(inputVal)) {
        alert("4桁の数字を入力してください。");
        return;
    }
    roomId = inputVal;
    roomRef = database.ref("rooms/" + roomId);
    joinRoom();
});

function joinRoom() {
    roomRef.once("value").then((snapshot) => {
        const roomData = snapshot.val();

        if (!roomData) {
            myRole = "player1";
            oppRole = "player2";
            const initialData = {
                player1: { hp: 3, hand: "", connected: true },
                player2: { hp: 3, hand: "", connected: false },
                roundStatus: "waiting"
            };
            roomRef.set(initialData).then(() => initGame());
        } else if (!roomData.player2.connected) {
            myRole = "player2";
            oppRole = "player1";
            roomRef.child("player2").set({ hp: 3, hand: "", connected: true })
                .then(() => initGame());
        } else {
            alert("このルームは満員です。");
        }
    });
}

function initGame() {
    lobbyScreen.style.display = "none";
    gameScreen.style.display = "flex";

    roomRef.child(myRole).child("connected").onDisconnect().set(false);
    roomRef.onDisconnect().remove();

    // データベースの状態変更を監視
    roomRef.on("value", (snapshot) => {
        gameState = snapshot.val();
        if (!gameState) return;

        // 相手の接続確認
        if (!gameState[oppRole] || !gameState[oppRole].connected) {
            if (gameState.roundStatus !== "finished") {
                showOverlay("WAITING ENEMY...");
                lockControls(true);
                return;
            }
        } else {
            if (gameState.roundStatus === "waiting") {
                hideOverlay();
                lockControls(false);
                roomRef.child("roundStatus").set("battling");
                return;
            }
        }

        // HPのUI更新
        updateHpUI(myHpContainer, gameState[myRole].hp);
        updateHpUI(oppHpContainer, gameState[oppRole].hp);

        // 自分の選択状態のUI更新
        if (gameState[myRole].hand) {
            myHandBox.textContent = "SET OK"; 
        } else if (!isProcessingRound) {
            myHandBox.textContent = "READY";
            resetButtonSelection();
        }

        // 相手の選択状態のUI表示（判定中以外は隠す）
        if (!isProcessingRound) {
            if (gameState[oppRole].hand) {
                oppHandBox.textContent = "SET OK";
            } else {
                oppHandBox.textContent = "READY";
            }
        }

        // お互いが手を出し終えた瞬間の処理
        if (gameState.roundStatus === "battling" && gameState.player1.hand && gameState.player2.hand && !isProcessingRound) {
            isProcessingRound = true;
            lockControls(true);
            
            // 出した手をオープン
            myHandBox.textContent = convertHandText(gameState[myRole].hand);
            oppHandBox.textContent = convertHandText(gameState[oppRole].hand);
            
            // 演出と次ラウンド移行のためのウェイト
            setTimeout(() => {
                if (myRole === "player1") {
                    judgeRound(gameState.player1.hand, gameState.player2.hand);
                }
            }, 1500);
        }
    });

    // チャットの監視
    roomRef.child("chat").on("child_added", (snapshot) => {
        const msg = snapshot.val();
        const msgDiv = document.createElement("div");
        msgDiv.className = "chat-row";
        msgDiv.textContent = msg.sender === myRole ? `1P: ${msg.text}` : `2P: ${msg.text}`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

// 勝敗および次ラウンド移行処理
function judgeRound(p1Hand, p2Hand) {
    let p1Hp = gameState.player1.hp;
    let p2Hp = gameState.player2.hp;

    if (p1Hand !== p2Hand) {
        if (
            (p1Hand === "G" && p2Hand === "C") ||
            (p1Hand === "C" && p2Hand === "P") ||
            (p1Hand === "P" && p2Hand === "G")
        ) {
            p2Hp--; 
        } else {
            p1Hp--; 
        }
    }

    const updates = {};
    updates["player1/hp"] = p1Hp;
    updates["player2/hp"] = p2Hp;
    updates["player1/hand"] = "";
    updates["player2/hand"] = "";

    if (p1Hp <= 0 || p2Hp <= 0) {
        updates["roundStatus"] = "finished";
        roomRef.update(updates).then(() => {
            setTimeout(() => {
                finishGame(p1Hp, p2Hp);
            }, 500);
        });
    } else {
        // 次のラウンドへ移行可能な状態に更新
        roomRef.update(updates).then(() => {
            // ローカルの判定処理中フラグを解除し、ボタンロックを開放
            isProcessingRound = false;
            lockControls(false);
        });
    }
}

function finishGame(p1Hp, p2Hp) {
    lockControls(true);
    let amIWinner = false;
    if (myRole === "player1" && p1Hp > 0) amIWinner = true;
    if (myRole === "player2" && p2Hp > 0) amIWinner = true;

    if (amIWinner) {
        showOverlay("GAME OVER - YOU WIN");
        myFace.textContent = "＼(^o^)／";
        oppFace.textContent = "( T_T )";
    } else {
        showOverlay("GAME OVER - YOU LOSE");
        myFace.textContent = "( T_T )";
        oppFace.textContent = "＼(^o^)／";
    }

    setTimeout(() => {
        roomRef.remove().then(() => {
            location.reload();
        });
    }, 5000);
}

// ボタン選択
handButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        if (!gameState || gameState.roundStatus !== "battling" || gameState[myRole].hand || isProcessingRound) return;
        
        const selectedHand = btn.getAttribute("data-hand");
        btn.classList.add("selected");
        roomRef.child(myRole).child("hand").set(selectedHand);
    });
});

// チャット送信
function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text || !roomRef) return;
    
    roomRef.child("chat").push({
        sender: myRole,
        text: text
    });
    chatInput.value = "";
}

chatSend.addEventListener("click", sendChatMessage);
chatInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendChatMessage();
});

function updateHpUI(container, hp) {
    const hearts = container.querySelectorAll(".heart");
    hearts.forEach((heart, index) => {
        if (index >= hp) {
            heart.classList.add("lost");
        } else {
            heart.classList.remove("lost");
        }
    });
}

function convertHandText(code) {
    if (code === "G") return "グー [ROCK]";
    if (code === "C") return "チョキ [SCISSORS]";
    if (code === "P") return "パー [PAPER]";
    return "READY";
}

function lockControls(state) {
    handButtons.forEach(btn => btn.disabled = state);
}

function resetButtonSelection() {
    handButtons.forEach(btn => btn.classList.remove("selected"));
}

function showOverlay(text) {
    messageOverlay.textContent = text;
    messageOverlay.style.display = "block";
}

function hideOverlay() {
    messageOverlay.style.display = "none";
}