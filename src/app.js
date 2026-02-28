// 店舗向け iPad 接客支援システムの MVP デモ実装。
// 目的: 「流れが動く」ことを優先し、精度よりも体験を重視。

const state = {
  stream: null,
  // 画像から抽出した特徴（簡易ルールベース）
  features: null,
  // 在庫データ（ダミーJSON）
  inventory: [],
};

const video = document.querySelector("#video");
const canvas = document.querySelector("#snapshotCanvas");
const startCameraBtn = document.querySelector("#startCameraBtn");
const captureBtn = document.querySelector("#captureBtn");
const fileInput = document.querySelector("#fileInput");
const featureList = document.querySelector("#featureList");
const recommendBtn = document.querySelector("#recommendBtn");
const recommendStatus = document.querySelector("#recommendStatus");
const recommendList = document.querySelector("#recommendList");

async function loadInventory() {
  const response = await fetch("./data/inventory.json");
  state.inventory = await response.json();
}

// iPad/モバイルを想定して背面カメラ優先。
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    recommendStatus.textContent = "このブラウザではカメラが使えません。画像選択をご利用ください。";
    return;
  }

  state.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 720 }, height: { ideal: 960 } },
    audio: false,
  });
  video.srcObject = state.stream;
  recommendStatus.textContent = "カメラを開始しました。撮影してください。";
}

function drawImageToCanvas(imgSource) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = imgSource.videoWidth || imgSource.naturalWidth;
  canvas.height = imgSource.videoHeight || imgSource.naturalHeight;

  ctx.drawImage(imgSource, 0, 0, canvas.width, canvas.height);

  // 撮影後は動画の代わりに静止画を表示。
  video.style.display = "none";
  canvas.style.display = "block";
}

function detectSeasonByBrightness(avgLuma) {
  if (avgLuma > 170) return "spring/summer";
  if (avgLuma > 120) return "all";
  return "autumn/winter";
}

function detectColorLabel(r, g, b) {
  if (r > g + 20 && r > b + 20) return "red";
  if (b > r + 20 && b > g + 10) return "blue";
  if (g > r + 20 && g > b + 10) return "green";
  if (r < 60 && g < 60 && b < 60) return "black";
  if (r > 190 && g > 190 && b > 190) return "white";
  return "neutral";
}

// 画像の画素から服装特徴を簡易抽出（MVPなので軽量ロジック）。
function extractFeaturesFromCanvas() {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;

  // 高速化のため間引きサンプリング。
  const stride = 40;
  let count = 0;
  for (let i = 0; i < data.length; i += stride) {
    totalR += data[i];
    totalG += data[i + 1];
    totalB += data[i + 2];
    count += 1;
  }

  const avgR = Math.round(totalR / count);
  const avgG = Math.round(totalG / count);
  const avgB = Math.round(totalB / count);
  const avgLuma = Math.round(0.299 * avgR + 0.587 * avgG + 0.114 * avgB);

  const silhouette = height > width ? "縦長シルエット" : "横広シルエット";
  const style = avgLuma > 145 ? "カジュアル" : "フォーマル";
  const season = detectSeasonByBrightness(avgLuma);
  const keyColor = detectColorLabel(avgR, avgG, avgB);

  // MVPでは上半身中心で「トップス」想定。
  state.features = {
    color: keyColor,
    silhouette,
    style,
    season,
    itemType: "トップス中心",
    avgLuma,
  };

  renderFeatures();
}

function renderFeatures() {
  if (!state.features) return;
  featureList.innerHTML = `
    <li>色味: ${state.features.color}</li>
    <li>シルエット: ${state.features.silhouette}</li>
    <li>テイスト推定: ${state.features.style}</li>
    <li>季節感: ${state.features.season}</li>
    <li>アイテム種別: ${state.features.itemType}</li>
  `;
}

function reasonForItem(item, features) {
  const reasons = [];

  if (item.color !== features.color) {
    reasons.push("現在のコーデに差し色として合います");
  }
  if ((features.style === "カジュアル" && item.taste === "カジュアル") || (features.style === "フォーマル" && item.taste === "フォーマル")) {
    reasons.push("全体のテイストと統一感があります");
  }
  if (item.season === "all" || features.season.includes(item.season)) {
    reasons.push("季節感に合わせやすい素材感です");
  }

  return reasons[0] || "いまの服装に自然になじむ一着です";
}

function scoreItem(item, features) {
  let score = 0;

  // 在庫があることが最優先要件。
  if (item.stock > 0) score += 50;
  else score -= 100;

  // 色相性: 同色よりも補色/差し色を軽く優遇。
  if (item.color !== features.color) score += 18;
  else score += 8;

  // テイスト一致。
  if ((features.style === "カジュアル" && item.taste === "カジュアル") || (features.style === "フォーマル" && item.taste === "フォーマル")) {
    score += 20;
  }

  // 季節一致。
  if (item.season === "all" || features.season.includes(item.season)) {
    score += 12;
  }

  return score;
}

function renderRecommendations(items) {
  if (!items.length) {
    recommendList.innerHTML = "<p>在庫ありの商品が見つかりませんでした。</p>";
    return;
  }

  recommendList.innerHTML = items
    .map(
      (entry) => `
      <article class="item">
        <img src="${entry.item.image}" alt="${entry.item.name}" />
        <div class="item-body">
          <div><strong>${entry.item.name}</strong></div>
          <div>カテゴリ: ${entry.item.category} / 色: ${entry.item.color}</div>
          <div class="price">¥${entry.item.price.toLocaleString()}</div>
          <div class="stock ${entry.item.stock > 0 ? "ok" : "ng"}">
            ${entry.item.stock > 0 ? `在庫あり（${entry.item.stock}）` : "在庫なし"}
          </div>
          <div>おすすめ理由: ${entry.reason}</div>
        </div>
      </article>
    `,
    )
    .join("");
}

function runRecommendation() {
  if (!state.features) {
    recommendStatus.textContent = "画像を先に撮影/選択してください。";
    return;
  }

  const ranked = state.inventory
    .map((item) => ({
      item,
      score: scoreItem(item, state.features),
      reason: reasonForItem(item, state.features),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  recommendStatus.textContent = "提案結果を表示しました（上位5件）。";
  renderRecommendations(ranked);
}

async function onFileSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const image = new Image();
  image.src = URL.createObjectURL(file);
  await image.decode();

  drawImageToCanvas(image);
  extractFeaturesFromCanvas();
  recommendStatus.textContent = "画像を読み込みました。おすすめ表示を押してください。";
}

function onCaptureClick() {
  if (!video.srcObject) {
    recommendStatus.textContent = "先にカメラ開始を押してください。";
    return;
  }

  drawImageToCanvas(video);
  extractFeaturesFromCanvas();
  recommendStatus.textContent = "撮影しました。おすすめ表示を押してください。";
}

startCameraBtn.addEventListener("click", () => {
  startCamera().catch((error) => {
    console.error(error);
    recommendStatus.textContent = "カメラ起動に失敗しました。画像選択をご利用ください。";
  });
});

captureBtn.addEventListener("click", onCaptureClick);
fileInput.addEventListener("change", onFileSelect);
recommendBtn.addEventListener("click", runRecommendation);

loadInventory().catch((error) => {
  console.error(error);
  recommendStatus.textContent = "在庫データの読み込みに失敗しました。";
});
