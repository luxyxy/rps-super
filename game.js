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
let myRole = ""; // "player1" または "player2"
let oppRole = ""; // "player2" または "player1"
let roomRef = null;
let gameState = null;

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

// ルーム入室ロジック
function joinRoom() {
    roomRef.once("value").then((snapshot) => {
        const roomData = snapshot.val();

        if (!roomData) {
            // ルームがなければ新しくplayer1として作成
            myRole = "player1";
            oppRole = "player2";
            const initialData = {
                player1: { hp: 3, hand: "", connected: true },
                player2: { hp: 3, hand: "", connected: false },
                roundStatus: "waiting" // waiting, battling, finished
            };
            roomRef.set(initialData).then(() => initGame());
        } else if (!roomData.player2.connected) {
            // player2が空いていれば入室
            myRole = "player2";
            oppRole = "player1";
            roomRef.child("player2").set({ hp: 3, hand: "", connected: true })
                .then(() => initGame());
        } else {
            alert("このルームは満員です。");
        }
    });
}

// ゲーム画面の初期化と監視
function initGame() {
    lobbyScreen.style.display = "none";
    gameScreen.style.display = "flex";

    // プレイヤーが切断された場合の自動削除処理を登録
    roomRef.child(myRole).child("connected").onDisconnect().set(false);
    // 自身が退出した、あるいは切断した際に自動でクリーンアップを試みる
    roomRef.onDisconnect().remove();

    // データベースの状態変更を監視
    roomRef.on("value", (snapshot) => {
        gameState = snapshot.val();
        if (!gameState) return;

        // 相手の接続確認
        if (!gameState[oppRole] || !gameState[oppRole].connected) {
            if (gameState.roundStatus !== "finished") {
                showOverlay("相手の待機中...");
                lockControls(true);
                return;
            }
        } else {
            if (gameState.roundStatus === "waiting") {
                hideOverlay();
                lockControls(false);
                roomRef.child("roundStatus").set("battling");
            }
        }

        // HPの更新
        updateHpUI(myHpContainer, gameState[myRole].hp);
        updateHpUI(oppHpContainer, gameState[oppRole].hp);

        // 自分が出した手の表示更新
        if (gameState[myRole].hand) {
            myHandBox.textContent = convertHandText(gameState[myRole].hand);
        } else {
            myHandBox.textContent = "？";
            resetButtonSelection();
        }

        // お互いが手を出し終えたか判定
        if (gameState.roundStatus === "battling" && gameState.player1.hand && gameState.player2.hand) {
            lockControls(true);
            oppHandBox.textContent = convertHandText(gameState[oppRole].hand);
            
            // 一瞬だけ判定処理を遅らせて手を見せる
            setTimeout(() => {
                if (myRole === "player1") {
                    judgeRound(gameState.player1.hand, gameState.player2.hand);
                }
            }, 1000);
        }
    });

    // チャットの監視
    roomRef.child("chat").on("child_added", (snapshot) => {
        const msg = snapshot.val();
        const msgDiv = document.createElement("div");
        msgDiv.className = "chat-row";
        msgDiv.textContent = msg.sender === myRole ? `自分: ${msg.text}` : `相手: ${msg.text}`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

// じゃんけんの勝敗判定 (player1側でのみ1回だけ計算してDBを更新する)
function judgeRound(p1Hand, p2Hand) {
    let p1Hp = gameState.player1.hp;
    let p2Hp = gameState.player2.hp;

    if (p1Hand !== p2Hand) {
        if (
            (p1Hand === "G" && p2Hand === "C") ||
            (p1Hand === "C" && p2Hand === "P") ||
            (p1Hand === "P" && p2Hand === "G")
        ) {
            p2Hp--; // player1の勝ち -> player2のHPマイナス
        } else {
            p1Hp--; // player2の勝ち -> player1のHPマイナス
        }
    }

    const updates = {
        "player1/hp": p1Hp,
        "player2/hp": p2Hp,
        "player1/hand": "",
        "player2/hand": ""
    };

    // どちらかのHPが0になったらゲーム終了
    if (p1Hp <= 0 || p2Hp <= 0) {
        updates["roundStatus"] = "finished";
        roomRef.update(updates).then(() => {
            setTimeout(() => {
                finishGame(p1Hp, p2Hp);
            }, 500);
        });
    } else {
        // 次のラウンドへ
        roomRef.update(updates).then(() => {
            oppHandBox.textContent = "？";
            lockControls(false);
        });
    }
}

// ゲーム決着処理とデータベースのクリーンアップ
function finishGame(p1Hp, p2Hp) {
    lockControls(true);
    let amIWinner = false;
    if (myRole === "player1" && p1Hp > 0) amIWinner = true;
    if (myRole === "player2" && p2Hp > 0) amIWinner = true;

    if (amIWinner) {
        showOverlay("あなたの勝ち！");
        myFace.textContent = "^-^";
        oppFace.textContent = "QAQ";
    } else {
        showOverlay("あなたの負け...");
        myFace.textContent = "QAQ";
        oppFace.textContent = "^-^";
    }

    // ゲーム終了後は3秒後にルームの全データを完全に消去してロビーに戻る
    setTimeout(() => {
        roomRef.remove().then(() => {
            location.reload();
        });
    }, 4000);
}

// 手ボタンのクリックイベント
handButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        if (gameState.roundStatus !== "battling" || gameState[myRole].hand) return;
        
        const selectedHand = btn.getAttribute("data-hand");
        btn.classList.add("selected");
        
        // 自分の手をデータベースに書き込み
        roomRef.child(myRole).child("hand").set(selectedHand);
    });
});

// チャット送信処理
function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    
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

// ユーティリティ関数群
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
    if (code === "G") return "グー";
    if (code === "C") return "チョキ";
    if (code === "P") return "パー";
    return "？";
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