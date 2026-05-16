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
// スプライト定数（実測値: 1097x960, 4列3行）
// ============================================================
const SP_W   = Math.floor(1097 / 4); // 274px
const SP_H   = Math.floor(960  / 3); // 320px
const DISP_W = 150;
const DISP_H = 176;

// 画像プリロード
const spriteImg = new Image();
spriteImg.src = "chara_set.png";

const imgGu    = new Image(); imgGu.src    = "gu.png";
const imgPa    = new Image(); imgPa.src    = "pa.png";
const imgChoki = new Image(); imgChoki.src = "choki.png";
const imgH1    = new Image(); imgH1.src    = "heart1.png"; // 赤ハート（HP あり）
const imgH2    = new Image(); imgH2.src    = "heart2.png"; // 空ハート（HP なし）

// ============================================================
// グローバル状態
// ============================================================
let myRole    = null;
let roomRef   = null;
let resolving = false;

// ============================================================
// ボタン登録（HTML ロード済みなので即登録）
// ============================================================
document.getElementById("btn-join").onclick        = onClickEnter;
document.getElementById("input-room-id").onkeydown = (e) => { if (e.key === "Enter") onClickEnter(); };
document.getElementById("btn-rock")    .onclick    = () => submitHand("rock");
document.getElementById("btn-paper")  .onclick    = () => submitHand("paper");
document.getElementById("btn-scissors").onclick    = () => submitHand("scissors");

// ============================================================
// ENTER ボタン処理
// ============================================================
function onClickEnter() {
    const roomId = document.getElementById("input-room-id").value.trim();
    if (!/^\d{4}$/.test(roomId)) { alert("4桁の数字を入力してください。"); return; }

    document.getElementById("btn-join").disabled          = true;
    document.getElementById("input-room-id").disabled     = true;

    const ref = db.ref("rooms/" + roomId);

    ref.once("value")
        .then((snap) => {
            const data = snap.val();
            log("ルームデータ:", data);

            // ルームなし → player1 として新規作成
            if (!data) {
                myRole = "player1"; roomRef = ref;
                return ref.set(freshRoom());
            }

            const p1on = !!(data.player1 && data.player1.connected);
            const p2on = !!(data.player2 && data.player2.connected);

            // 両者オフライン（残骸） → リセットして player1
            if (!p1on && !p2on) {
                myRole = "player1"; roomRef = ref;
                return ref.set(freshRoom());
            }

            // player1 だけオンライン → 自分が player2
            if (p1on && !p2on) {
                myRole = "player2"; roomRef = ref;
                return ref.child("player2").update({ hp: 3, hand: "", connected: true, charId: rand4() });
            }

            // player2 だけオンライン（player1 が落ちた）→ player1 として再参加
            if (!p1on && p2on) {
                myRole = "player1"; roomRef = ref;
                return ref.child("player1").update({ hp: 3, hand: "", connected: true, charId: rand4() });
            }

            // 両者オンライン → 満員
            throw new Error("FULL");
        })
        .then(() => {
            log("書き込み完了 / role =", myRole);
            showGameScreen(document.getElementById("input-room-id").value.trim());
            startWatching();
        })
        .catch((err) => {
            log("エラー:", err.message);
            alert(err.message === "FULL" ? "このルームは満員です。" : "エラー: " + err.message);
            document.getElementById("btn-join").disabled      = false;
            document.getElementById("input-room-id").disabled = false;
        });
}

function freshRoom() {
    return {
        player1:     { hp: 3, hand: "", connected: true,  charId: rand4() },
        player2:     { hp: 3, hand: "", connected: false, charId: null    },
        roundStatus: "waiting",
        resultText:  ""
    };
}

function rand4() { return Math.floor(Math.random() * 4); }
function log(...a) { console.log("[RPS]", ...a); }

// ============================================================
// ゲーム画面へ切り替え
// ============================================================
function showGameScreen(roomId) {
    document.getElementById("setup-screen").style.display  = "none";
    document.getElementById("game-screen").style.display   = "flex";
    document.getElementById("display-room-id").textContent = roomId;
    document.getElementById("display-role").textContent    = myRole === "player1" ? "P1" : "P2";

    // canvas サイズを face-wrap に合わせる
    ["face-canvas-p1", "face-canvas-p2"].forEach((id) => {
        const c = document.getElementById(id);
        c.width = DISP_W; c.height = DISP_H;
    });

    // スマホで face-wrap が縮小されている場合、DISP を合わせる
    const wrap = document.querySelector(".face-wrap");
    if (wrap) {
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (w && h) {
            ["face-canvas-p1", "face-canvas-p2"].forEach((id) => {
                const c = document.getElementById(id);
                c.width = w; c.height = h;
            });
        }
    }

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

        // player1 だけが勝敗処理を担当
        if (
            myRole === "player1"         &&
            !resolving                   &&
            d.roundStatus === "waiting"  &&
            d.player1 && d.player1.hand  &&
            d.player2 && d.player2.hand  &&
            d.player2.connected
        ) {
            resolveRound(d);
        }
    });

    // ページ離脱時にルーム削除
    window.addEventListener("beforeunload", () => {
        if (roomRef) { roomRef.remove(); roomRef = null; }
    });
}

// ============================================================
// 手を出す
// ============================================================
function submitHand(hand) {
    if (!roomRef || !myRole) { log("未接続"); return; }
    roomRef.once("value").then((snap) => {
        const d = snap.val();
        if (!d)                                     return;
        if (d.roundStatus !== "waiting")            { log("結果表示中"); return; }
        if (d[myRole] && d[myRole].hand)            { log("選択済み"); return; }
        if (!d.player2 || !d.player2.connected)     { log("相手未接続"); return; }
        log("手を出す:", hand);
        roomRef.child(myRole + "/hand").set(hand);
    });
}

// ============================================================
// 勝敗処理（player1 のみ実行）
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

    log("判定:", h1, "vs", h2, "->", r, "|", text);

    roomRef.update({
        "player1/hp": p1hp, "player2/hp": p2hp,
        "player1/hand": h1, "player2/hand": h2,
        roundStatus: "result", resultText: text
    }).then(() => {
        if (over) {
            // ゲーム終了 → 3秒後にルーム削除
            setTimeout(() => {
                if (roomRef) roomRef.remove().then(() => { log("ルーム削除"); roomRef = null; });
            }, 3000);
            resolving = false;
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
// UI 描画
// ============================================================
function renderUI(d) {
    const p1  = d.player1;
    const p2  = d.player2;
    const p2on = !!(p2 && p2.connected);

    // ハートHP
    renderHearts("p1-hp-row", p1 ? p1.hp : 0, true);
    if (p2on) {
        renderHearts("p2-hp-row", p2.hp, true);
    } else {
        document.getElementById("p2-hp-row").innerHTML =
            '<span class="hp-waiting">WAITING...</span>';
    }

    // 顔
    drawFace("face-canvas-p1", p1);
    drawFace("face-canvas-p2", p2on ? p2 : null);

    // バトルフィールド
    renderBattle(d);
}

// ============================================================
// ハート HP 表示
// ============================================================
function renderHearts(containerId, hp, _max3) {
    const el = document.getElementById(containerId);
    el.innerHTML = "";
    for (let i = 0; i < 3; i++) {
        const img = document.createElement("img");
        img.src    = i < hp ? imgH1.src : imgH2.src;
        img.width  = 28;
        img.height = 28;
        img.style.imageRendering = "pixelated";
        el.appendChild(img);
    }
}

// ============================================================
// 顔スプライト描画（canvas.drawImage で正確に切り出す）
// ============================================================
function drawFace(canvasId, playerData) {
    const cvs = document.getElementById(canvasId);
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    const w = cvs.width;
    const h = cvs.height;
    ctx.clearRect(0, 0, w, h);

    if (!playerData || playerData.charId == null) {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, w, h);
        return;
    }

    const doRender = () => {
        const col = playerData.charId;           // 0〜3（横）
        const row = spriteRow(playerData.hp);    // 0〜2（縦）
        ctx.drawImage(spriteImg,
            col * SP_W, row * SP_H, SP_W, SP_H, // ソース矩形
            0, 0, w, h                           // 描画先（canvas全面）
        );
    };

    if (spriteImg.complete && spriteImg.naturalWidth > 0) {
        doRender();
    } else {
        spriteImg.onload = doRender;
    }
}

function spriteRow(hp) {
    if (hp >= 3) return 0;
    if (hp === 2) return 1;
    return 2;
}

// ============================================================
// バトルフィールド テキスト/画像表示
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

    // 手を並べる
    let html = '<div class="hand-row">';

    // 自分の手
    html += '<div class="hand-cell"><span>あなた</span>';
    if (myHand) {
        html += '<img class="hand-img" src="' + handSrc(myHand) + '" alt="' + myHand + '">';
    } else {
        html += '<div class="hand-placeholder">?</div>';
    }
    html += '</div>';

    html += '<div class="vs-label">VS</div>';

    // 相手の手
    html += '<div class="hand-cell"><span>相手</span>';
    if (status === "result" && oppHand) {
        html += '<img class="hand-img" src="' + handSrc(oppHand) + '" alt="' + oppHand + '">';
    } else if (oppHand) {
        html += '<div class="hand-placeholder">...</div>';
    } else {
        html += '<div class="hand-placeholder">?</div>';
    }
    html += '</div>';

    html += '</div>'; // .hand-row

    // 結果テキスト
    if (status === "result") {
        html += '<div class="result-text">' + (d.resultText || "") + '</div>';
    }

    el.innerHTML = html;
}

function handSrc(hand) {
    return { rock: "gu.png", paper: "pa.png", scissors: "choki.png" }[hand] || "";
}
