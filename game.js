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
// スプライト定数（実測値）
// 画像全体 1097x960、4列3行
// 1コマ = 274.25 x 320  → 整数で 274 x 320
// ============================================================
const SP_COLS  = 4;
const SP_ROWS  = 3;
const SP_W     = Math.floor(1097 / SP_COLS); // 274
const SP_H     = Math.floor(960  / SP_ROWS); // 320

// 表示サイズ（face-wrap と合わせること）
const DISP_W   = 150;
const DISP_H   = 176;

// スプライト画像（一度だけロード）
const spriteImg = new Image();
spriteImg.src   = "chara_set.png";

// ============================================================
// グローバル状態
// ============================================================
let myRole    = null;
let roomRef   = null;
let resolving = false;

// ============================================================
// ボタン登録（DOMが存在するので即登録）
// ============================================================
document.getElementById("btn-join").onclick = onClickEnter;
document.getElementById("input-room-id").onkeydown = (e) => { if (e.key === "Enter") onClickEnter(); };
document.getElementById("btn-rock")    .onclick = () => submitHand("rock");
document.getElementById("btn-paper")   .onclick = () => submitHand("paper");
document.getElementById("btn-scissors").onclick = () => submitHand("scissors");

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

    ref.once("value")
        .then((snap) => {
            const data = snap.val();
            log("ルームデータ:", data);

            if (!data) {
                // 新規ルーム → player1
                myRole  = "player1";
                roomRef = ref;
                return ref.set({
                    player1:     { hp: 3, hand: "", connected: true,  charId: rand4() },
                    player2:     { hp: 3, hand: "", connected: false, charId: null    },
                    roundStatus: "waiting",
                    resultText:  ""
                });
            }

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
        })
        .then(() => {
            log("書き込み成功 / role =", myRole);
            showGameScreen(document.getElementById("input-room-id").value.trim());
            startWatching();
        })
        .catch((err) => {
            log("エラー:", err.message);
            alert(err.message === "FULL" ? "このルームは満員です。" : "エラー: " + err.message);
            document.getElementById("btn-join").disabled = false;
            document.getElementById("input-room-id").disabled = false;
        });
}

function rand4() { return Math.floor(Math.random() * SP_COLS); }
function log(...a) { console.log("[RPS]", ...a); }

// ============================================================
// ゲーム画面へ切り替え
// ============================================================
function showGameScreen(roomId) {
    document.getElementById("setup-screen").style.display = "none";
    document.getElementById("game-screen").style.display  = "flex";
    document.getElementById("display-room-id").textContent = roomId;
    document.getElementById("display-role").textContent    = myRole === "player1" ? "P1" : "P2";

    // canvas サイズを face-wrap に合わせる
    setupFaceCanvas("face-canvas-p1");
    setupFaceCanvas("face-canvas-p2");
    log("ゲーム画面表示");
}

function setupFaceCanvas(id) {
    const cvs = document.getElementById(id);
    cvs.width  = DISP_W;
    cvs.height = DISP_H;
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

        // player1だけが勝敗判定
        if (
            myRole === "player1"        &&
            !resolving                  &&
            d.roundStatus === "waiting" &&
            d.player1 && d.player1.hand &&
            d.player2 && d.player2.hand &&
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
// 手を出す
// ============================================================
function submitHand(hand) {
    if (!roomRef || !myRole) { log("未接続"); return; }

    roomRef.once("value").then((snap) => {
        const d = snap.val();
        if (!d) return;
        if (d.roundStatus !== "waiting")            { log("結果表示中"); return; }
        if (d[myRole] && d[myRole].hand)            { log("選択済み"); return; }
        if (!d.player2 || !d.player2.connected)     { log("相手未接続"); return; }

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
    const r  = judge(h1, h2);

    let p1hp = d.player1.hp;
    let p2hp = d.player2.hp;
    let text = "";

    if      (r === "p1win") { p2hp = Math.max(0, p2hp - 1); text = "PLAYER 1 WIN !"; }
    else if (r === "p2win") { p1hp = Math.max(0, p1hp - 1); text = "PLAYER 2 WIN !"; }
    else                    { text = "DRAW"; }

    const over = p1hp <= 0 || p2hp <= 0;
    if (p1hp <= 0) text = "PLAYER 1 LOSE  --  GAME OVER";
    if (p2hp <= 0) text = "PLAYER 2 LOSE  --  GAME OVER";

    log("判定:", h1, "vs", h2, "->", r, text);

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
    if (
        (h1 === "rock"     && h2 === "scissors") ||
        (h1 === "scissors" && h2 === "paper")    ||
        (h1 === "paper"    && h2 === "rock")
    ) return "p1win";
    return "p2win";
}

// ============================================================
// UI描画
// ============================================================
function renderUI(d) {
    const p1 = d.player1;
    const p2 = d.player2;
    const p2on = p2 && p2.connected;

    // HP表示（絵文字なし）
    const p1HpEl = document.getElementById("p1-hp");
    p1HpEl.textContent = p1 ? "HP: " + hpBar(p1.hp) : "HP: ---";
    p1HpEl.className   = "hp-bar";

    const p2HpEl = document.getElementById("p2-hp");
    if (p2on) {
        p2HpEl.textContent = "HP: " + hpBar(p2.hp);
        p2HpEl.className   = "hp-bar";
    } else {
        p2HpEl.textContent = "WAITING...";
        p2HpEl.className   = "hp-bar waiting";
    }

    // 顔
    drawFace("face-canvas-p1", p1);
    drawFace("face-canvas-p2", p2on ? p2 : null);

    // バトルフィールド
    renderBattle(d);
}

// HP を [ ### ] 形式で表示
function hpBar(hp) {
    const filled = Math.max(0, hp);
    const empty  = Math.max(0, 3 - filled);
    return "[ " + "###".slice(0, filled) + "---".slice(0, empty) + " ]";
}

// ============================================================
// 顔スプライト描画（canvas）
// ============================================================
function drawFace(canvasId, playerData) {
    const cvs = document.getElementById(canvasId);
    if (!cvs) return;
    const c = cvs.getContext("2d");
    c.clearRect(0, 0, DISP_W, DISP_H);

    if (!playerData || playerData.charId == null) {
        // 待機中：薄いグレー枠だけ
        c.fillStyle = "#111";
        c.fillRect(0, 0, DISP_W, DISP_H);
        c.fillStyle = "#444";
        c.font = "12px monospace";
        c.fillText("NO DATA", 28, DISP_H / 2);
        return;
    }

    if (!spriteImg.complete || spriteImg.naturalWidth === 0) {
        // 画像ロード前
        c.fillStyle = "#111";
        c.fillRect(0, 0, DISP_W, DISP_H);
        return;
    }

    const col = playerData.charId;          // 0〜3（横）
    const row = spriteRow(playerData.hp);   // 0〜2（縦）

    const sx = col * SP_W;
    const sy = row * SP_H;

    c.drawImage(
        spriteImg,
        sx, sy, SP_W, SP_H,   // ソース矩形
        0, 0, DISP_W, DISP_H  // 描画先
    );
}

function spriteRow(hp) {
    if (hp >= 3) return 0;
    if (hp === 2) return 1;
    return 2;
}

// ============================================================
// バトルフィールド（テキスト表示）
// ============================================================
function renderBattle(d) {
    const el     = document.getElementById("battle-text");
    const p2on   = d.player2 && d.player2.connected;
    const status = d.roundStatus || "waiting";

    if (!p2on) {
        el.style.color = "#00ffff";
        el.innerHTML   = "相手の参加を待っています...";
        return;
    }

    const myHand  = d[myRole]  ? d[myRole].hand  : "";
    const oppRole = myRole === "player1" ? "player2" : "player1";
    const oppHand = d[oppRole] ? d[oppRole].hand  : "";

    let html = "";

    // 自分の手
    if (myHand) {
        html += '<span style="color:#00ff00;">あなた : ' + jaHand(myHand) + '</span><br>';
    } else {
        html += '<span style="color:#666;">手を選んでください...</span><br>';
    }

    // 相手の手
    if (status === "result" && oppHand) {
        html += '<span style="color:#ff8800;">相手   : ' + jaHand(oppHand) + '</span><br>';
    } else if (oppHand) {
        html += '<span style="color:#666;">相手   : 選択済み</span><br>';
    } else {
        html += '<span style="color:#666;">相手   : 待機中...</span><br>';
    }

    // 結果
    if (status === "result") {
        html += '<br><span style="color:#ffff00;font-size:1.2em;letter-spacing:2px;">'
              + (d.resultText || "") + '</span>';
    }

    el.innerHTML = html;
}

function jaHand(h) {
    return { rock: "GU", paper: "PA", scissors: "CHOKI" }[h] || h;
}
