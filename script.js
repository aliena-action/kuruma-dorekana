"use strict";

const CARS = [
  { id: "car_red", imagePath: "assets/car_red_full.png" },
  { id: "car_blue", imagePath: "assets/car_blue_full.png" },
  { id: "car_yellow", imagePath: "assets/car_yellow_full.png" },
  { id: "car_green", imagePath: "assets/car_green_full.png" },
];

const MESSAGES = {
  sample: "このくるまと おなじ くるまを えらんでね",
  correct: "やったー！ おなじだね！",
  wrong: ["えへへ、ぼくじゃないよ〜", "もういちど！"],
};

const TIMING = { sampleToChoose: 1500, correctToNext: 1800, wrongLock: 600 };

const gameState = { sampleCar: null, choices: [], locked: false, lastSampleId: null };

const el = {
  game: document.getElementById("game"),
  screenTitle: document.getElementById("screen-title"),
  screenPlay: document.getElementById("screen-play"),
  btnStart: document.getElementById("btn-start"),
  message: document.getElementById("message"),
  sampleCar: document.getElementById("sample-car"),
  laneChoices: document.getElementById("lane-choices"),
  sparkleLayer: document.getElementById("sparkle-layer"),
};

function randomInt(max) { return Math.floor(Math.random() * max); }

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showMessage(text) {
  el.message.textContent = text;
  el.message.classList.remove("pop");
  void el.message.offsetWidth;
  el.message.classList.add("pop");
}

function buildQuestion() {
  let candidates = CARS.filter((car) => car.id !== gameState.lastSampleId);
  if (candidates.length === 0) candidates = CARS;
  const sample = candidates[randomInt(candidates.length)];
  gameState.sampleCar = sample;
  gameState.lastSampleId = sample.id;
  const others = shuffle(CARS.filter((car) => car.id !== sample.id)).slice(0, 2);
  gameState.choices = shuffle([sample, ...others]);
}

function startQuestion() {
  buildQuestion();
  gameState.locked = true;
  el.sampleCar.src = gameState.sampleCar.imagePath;
  el.sampleCar.classList.remove("slide-in");
  void el.sampleCar.offsetWidth;
  el.sampleCar.classList.add("slide-in");
  el.laneChoices.innerHTML = "";
  showMessage(MESSAGES.sample);
  setTimeout(showChoices, TIMING.sampleToChoose);
}

function showChoices() {
  el.laneChoices.innerHTML = "";
  gameState.choices.forEach((car) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice enter";
    btn.dataset.carId = car.id;
    btn.setAttribute("aria-label", "くるま");
    const img = document.createElement("img");
    img.src = car.imagePath;
    img.alt = "";
    btn.appendChild(img);
    btn.addEventListener("click", () => onChoiceTap(btn, car));
    el.laneChoices.appendChild(btn);
  });
  gameState.locked = false;
}

function onChoiceTap(btn, car) {
  if (gameState.locked) return;
  if (car.id === gameState.sampleCar.id) handleCorrect(btn);
  else handleWrong(btn);
}

function handleWrong(btn) {
  gameState.locked = true;
  btn.classList.remove("wiggle");
  void btn.offsetWidth;
  btn.classList.add("wiggle");
  showMessage(MESSAGES.wrong[randomInt(MESSAGES.wrong.length)]);
  setTimeout(() => { gameState.locked = false; }, TIMING.wrongLock);
}

function handleCorrect(btn) {
  gameState.locked = true;
  btn.classList.add("jump");
  el.laneChoices.querySelectorAll(".choice").forEach((choice) => {
    if (choice !== btn) choice.classList.add("fade-out");
  });
  showMessage(MESSAGES.correct);
  spawnSparkles(btn);
  setTimeout(startQuestion, TIMING.correctToNext);
}

function spawnSparkles(btn) {
  const rect = btn.getBoundingClientRect();
  const layerRect = el.sparkleLayer.getBoundingClientRect();
  const cx = rect.left + rect.width / 2 - layerRect.left;
  const cy = rect.top + rect.height / 2 - layerRect.top;
  const glyphs = ["✨", "⭐", "🌟"];
  for (let i = 0; i < 10; i++) {
    const sparkle = document.createElement("span");
    sparkle.className = "sparkle";
    sparkle.textContent = glyphs[randomInt(glyphs.length)];
    const angle = (Math.PI * 2 * i) / 10;
    const dist = 60 + Math.random() * 80;
    sparkle.style.left = `${cx}px`;
    sparkle.style.top = `${cy}px`;
    sparkle.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    sparkle.style.setProperty("--dy", `${Math.sin(angle) * dist - 40}px`);
    el.sparkleLayer.appendChild(sparkle);
    sparkle.addEventListener("animationend", () => sparkle.remove());
  }
}

function preloadImages() {
  CARS.forEach((car) => {
    const img = new Image();
    img.src = car.imagePath;
  });
}

el.btnStart.addEventListener("click", () => {
  el.screenTitle.hidden = true;
  el.screenPlay.hidden = false;
  startQuestion();
});

preloadImages();
