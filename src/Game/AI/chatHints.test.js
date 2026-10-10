// Run: node --test src/Game/AI/chatHints.test.js
//
// I79: when the model cannot structure a player's order, the engine decides
// from the words alone whether it asks for talks. The list was English plus
// Russian stems behind \b, which is an ASCII boundary in JavaScript, so no
// Russian order ever matched and no other language was tried.

import test from "node:test";
import assert from "node:assert/strict";

import { looksLikeChatRequest } from "./chatHints.js";

test("a request for talks is found in every shipped language", () => {
  const talks = [
    "Open negotiations with France over the border",
    "Ouvrir des négociations avec l'Allemagne",
    "Friedensverhandlungen mit Russland aufnehmen",
    "Ein Gespräch mit Polen führen",
    "Negociar un alto el fuego con Marruecos",
    "Iniciar conversas com Angola",
    "Avviare trattative con l'Austria",
    "Onderhandelen met België over de haven",
    "Inleda förhandlingar med Norge",
    "Rozpocząć negocjacje z Litwą",
    "Начать переговоры с Китаем",
    "Провести зустріч з Польщею",
    "Yunanistan ile müzakere başlat",
    "Adakan pertemuan dengan Malaysia",
    "Đàm phán với Trung Quốc",
    "بدء المفاوضات مع مصر",
    "آغاز مذاکره با ترکیه",
    "بھارت کے ساتھ مذاکرات شروع کریں",
    "पाकिस्तान के साथ वार्ता शुरू करें",
    "ভারতের সাথে আলোচনা শুরু করুন",
    "เจรจากับกัมพูชา",
    "中国と交渉を開始する",
    "일본과 협상을 시작하라",
    "与日本开始谈判",
  ];
  for (const text of talks) assert.equal(looksLikeChatRequest(text), true, text);
});

test("an order that is not talks stays an action", () => {
  const actions = [
    "Invade Poland from the east",
    "Purchase new artillery for the reserve",
    "Mobiliser l'armée de réserve",
    "Maßnahmen gegen die Inflation treffen",
    "Den Nachrichtendienst ausbauen",
    "Reunificar el país por la fuerza",
    "Строительство домов в Киеве",
    "Birlikleri sınıra konuşlandır",
    "إرسال قوات إلى الحدود",
    "动员预备役部队",
    "Begin the conversion of civilian factories to arms production",
    "Reunir las tropas en la frontera",
    "Reunir as tropas na fronteira",
    "Нанести встречный удар по противнику",
    "Встретить наступление противника огнём артиллерии",
    "Завдати зустрічного удару",
    "Налагодити зв'язок між підрозділами",
    "السيطرة على قمة التل",
    "Fortify the chateau at Hougoumont",
    "",
    null,
  ];
  for (const text of actions) assert.equal(looksLikeChatRequest(text), false, String(text));
});

test("a stem must start a word where words are written apart", () => {
  assert.equal(looksLikeChatRequest("purchase"), false, "chat inside purchase");
  assert.equal(looksLikeChatRequest("Chat with Japan"), true);
  assert.equal(looksLikeChatRequest("summit in Geneva"), true);
  assert.equal(looksLikeChatRequest("Iniciar una conversación con Chile"), true);
  assert.equal(looksLikeChatRequest("Назначить встречу с послом Японии"), true);
  assert.equal(looksLikeChatRequest("Встретиться с президентом Франции"), true);
  assert.equal(looksLikeChatRequest("Зв'язатися з урядом Польщі"), true);
});
