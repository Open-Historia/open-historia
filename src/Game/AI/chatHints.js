/*! Open Historia — does an order ask for talks? © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// When the model cannot turn a player's order into a structured command
// (gameplay.js fallbackDescriptionToAction), the engine decides by itself
// whether the order asks for a conversation or an action. All it has is the
// text the player typed: no kind, no target, no structure to read. So it reads
// words, in every language the game ships a pack for.
//
// The old list was English, and a handful of Russian stems behind \b, which
// in a JavaScript regex is an ASCII word boundary: "переговоры" never matched,
// and nor did anything in French, German, Arabic or Chinese.
//
// Stems, matched case-insensitively. In a language that writes words apart
// (Latin and Cyrillic scripts) a stem must start a word, so "chat" is not
// found inside "purchase" (WORD_STEMS). German compounds ("Friedensgespräche")
// and scripts that join prefixes to the word (Arabic "والمفاوضات") or write no
// spaces at all (Chinese, Japanese, Thai) may have it anywhere. A stem that is
// also the start of a common military or everyday word is left out
// ("konuşlandır", deploy, beside "konuşma", talk; the Arabic "إرسال", sending,
// beside "رسالة", a letter), since a fallback that opens a chat for an
// invasion order is worse than one that misses a request for talks.

const WORD_STEMS = [
  // English
  "chat", "conference", "contact", "diplomac", "meet", "message", "negotiat", "outreach", "parley",
  "peace talk", "reach out", "speak with", "summit", "talk to", "talk with", "talks with",
  // French
  "négoci", "negoci", "pourparler", "diplomat", "sommet", "conférence", "rencontr", "contacter", "discut", "dialogu",
  // Spanish and Portuguese
  "diplomac", "diplomát", "cumbre", "conferencia", "conferência", "reunión", "reunião", "reunir", "contact", "contat", "mensaje", "mensagem",
  "convers", "diálogo", "dialogo", "hablar con", "falar com", "cúpula", "charla",
  // Italian
  "negoziat", "trattativ", "diplomaz", "vertice", "conferenza", "incontr", "contatt", "messaggio", "colloqui", "parlare con",
  // Dutch
  "onderhandel", "conferentie", "ontmoet", "gesprek", "overleg", "praten met", "topoverleg",
  // Swedish
  "förhandl", "toppmöte", "konferens", "möte", "möta", "kontakt", "meddelande", "samtal", "prata med",
  // German, where a word starts with the stem
  "treffen mit", "nachricht an",
  // Polish
  "negocj", "rozmow", "dyplomac", "dyplomat", "szczyt", "konferencj", "spotka", "wiadomoś", "porozmawia",
  // Russian
  "переговор", "встреч", "встрет", "дипломат", "связаться", "свяжитесь", "чат", "договор", "саммит", "конференц",
  "контакт", "сообщени", "бесед", "поговорить",
  // Ukrainian
  "зустр", "зв'яз", "зв’яз", "домовитис", "домовлен", "саміт", "повідомлен", "розмов", "поговорити",
  // Turkish
  "müzakere", "görüşme", "diplomasi", "zirve", "konferans", "buluş", "temas", "iletişim", "mesaj", "sohbet", "konuşma",
  // Indonesian
  "negosiasi", "runding", "konferensi", "bertemu", "pertemuan", "hubungi", "bicara", "dialog", "obrol", "ktt",
  // Vietnamese
  "đàm phán", "thương lượng", "ngoại giao", "hội nghị", "gặp", "liên lạc", "liên hệ", "tin nhắn", "trò chuyện", "đối thoại", "nói chuyện",
];

// German compounds put the stem mid-word ("Friedensverhandlungen").
const GERMAN_STEMS = ["verhandl", "gespräch", "gipfel", "konferenz", "diplomat", "kontakt", "unterred", "sprechen mit"];

// Scripts that join prefixes to a word, or write no spaces.
const INSIDE_STEMS = [
  // Arabic
  "فاوض", "دبلوماس", "قمة", "مؤتمر", "لقاء", "اتصال", "رسالة", "محادث", "حوار",
  // Persian
  "مذاکره", "دیپلماس", "اجلاس", "کنفرانس", "ملاقات", "دیدار", "تماس", "پیام", "گفتگو", "گفت‌وگو", "صحبت",
  // Urdu
  "مذاکرات", "سفارت", "اجلاس", "کانفرنس", "رابطہ", "پیغام", "بات چیت",
  // Hindi
  "वार्ता", "बातचीत", "कूटनीति", "राजनय", "सम्मेलन", "मुलाकात", "संपर्क", "संदेश", "चर्चा",
  // Bengali
  "আলোচনা", "আলাপ", "কূটনী", "কূটনৈ", "সম্মেলন", "বৈঠক", "সাক্ষাৎ", "যোগাযোগ", "বার্তা", "দর কষাকষি",
  // Thai
  "เจรจา", "การทูต", "ประชุม", "พบปะ", "ติดต่อ", "ข้อความ", "สนทนา", "หารือ", "พูดคุย",
  // Japanese
  "交渉", "外交", "会談", "会議", "面会", "接触", "連絡", "メッセージ", "対話", "協議", "チャット", "話し合",
  // Korean
  "협상", "외교", "회담", "회의", "만나", "만남", "접촉", "연락", "메시지", "대화", "채팅", "협의",
  // Chinese (simplified and traditional)
  "谈判", "談判", "峰会", "峰會", "会议", "會議", "会谈", "會談", "会面", "會面", "会晤", "會晤", "接触", "接觸",
  "联系", "聯繫", "对话", "對話", "聊天", "协商", "協商", "磋商",
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alternation = (stems) => [...new Set(stems)].map(escape).join("|");

// A word start: not after a letter, a mark or a digit of any script.
const AT_WORD_START = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${alternation(WORD_STEMS)})`, "iu");
const ANYWHERE = new RegExp(`(?:${alternation([...GERMAN_STEMS, ...INSIDE_STEMS])})`, "iu");

export const looksLikeChatRequest = (text) => {
  const value = String(text ?? "").normalize("NFC");
  if (!value.trim()) return false;
  return AT_WORD_START.test(value) || ANYWHERE.test(value);
};
