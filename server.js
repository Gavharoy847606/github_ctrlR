import TelegramBot from "node-telegram-bot-api";
import 'dotenv/config'
import axios from "axios";
import fs from "fs";

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

// Hugging Face API konfiguratsiyasi
const HF_API_KEY = "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"; // Bu yerga o'z keyingizni qo'ying
const HF_API_URL =
  "https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0";

const botwithAi = [{ key: "images", label: "🖼 Suratlar" }];

// Foydalanuvchi holatini saqlash
const userStates = {};

// Keyboard yasash funksiyasi
function buildKeyboard(options) {
  return options.map((option) => [{ text: option.label }]);
}

// /start buyrug'i
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "Xush kelibsiz! Quyidagi tanlovlardan birini tanlang:",
    {
      reply_markup: {
        keyboard: buildKeyboard(botwithAi),
        resize_keyboard: true,
        one_time_keyboard: false,
      },
    },
  );
});

// /surat buyrug'i
bot.onText(/\/surat (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userPrompt = match[1];

  if (!userPrompt || userPrompt.trim().length === 0) {
    bot.sendMessage(
      chatId,
      `Iltimos Suratni tayyorlash uchun to'g'ri so'rov yuboring!\nMisol: /surat chiroyli manzara`,
    );
    return;
  }

  await generateImage(chatId, userPrompt);
});

// Hugging Face API orqali surat yaratish
async function generateImage(chatId, prompt) {
  const workingImg = await bot.sendMessage(
    chatId,
    `⏳ Surat yaratish jarayoni boshlandi...\n\nSo'rov: "${prompt}"\n\nIltimos kutib turing...`,
  );

  const file = `generated-image-${Date.now()}.png`;

  try {
    // Hugging Face API ga so'rov yuborish
    const response = await axios({
      method: "post",
      url: HF_API_URL,
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "image/png", // Bu qator qo'shildi - muhim!
      },
      data: {
        inputs: prompt,
      },
      responseType: "arraybuffer", // Rasm ma'lumotlarini olish uchun
      timeout: 60000, // 60 soniya timeout
    });

    // Rasmni faylga saqlash
    fs.writeFileSync(file, response.data);

    // Yuklash xabarini o'chirish
    await bot.deleteMessage(chatId, workingImg.message_id);

    // Rasmni yuborish
    await bot.sendPhoto(chatId, file, {
      caption: `✅ Sizning suratingiz tayyor!\n\n📝 So'rov: "${prompt}"`,
    });

    // Faylni o'chirish
    fs.unlinkSync(file);

    // Holatni tozalash
    delete userStates[chatId];
  } catch (error) {
    console.error("Xatolik:", error.message);

    // Agar error response buffer bo'lsa, uni stringga o'tkazish
    let errorMessage = "❌ Texnik nosozlik yuzaga keldi.";

    if (error.response?.data) {
      try {
        const errorText = Buffer.isBuffer(error.response.data)
          ? error.response.data.toString("utf-8")
          : JSON.stringify(error.response.data);
        console.error("API xatoligi:", errorText);

        // Xatolik turini aniqlash
        if (
          errorText.includes("currently loading") ||
          errorText.includes("is currently loading")
        ) {
          errorMessage =
            "⏳ Model yuklanmoqda. Iltimos 20-30 soniyadan keyin qayta urinib ko'ring!";
        } else if (errorText.includes("Authorization")) {
          errorMessage = "❌ API key noto'g'ri yoki yaroqsiz!";
        }
      } catch (e) {
        console.error("Error parse qilishda muammo:", e);
      }
    }

    // Status code bo'yicha xatoliklarni qayta ishlash
    if (error.response?.status === 401) {
      errorMessage = "❌ API key noto'g'ri yoki yaroqsiz!";
    } else if (error.response?.status === 503) {
      errorMessage =
        "⏳ Model yuklanmoqda. Iltimos 20-30 soniyadan keyin qayta urinib ko'ring!";
    } else if (error.response?.status === 429) {
      errorMessage =
        "⏸ So'rovlar soni chegaradan oshdi. Iltimos bir oz kuting.";
    }

    await bot.editMessageText(errorMessage, {
      chat_id: chatId,
      message_id: workingImg.message_id,
    });

    delete userStates[chatId];
  }
}

// Oddiy xabarlarni qayta ishlash
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Buyruqlarni o'tkazib yuborish
  if (text && text.startsWith("/")) {
    return;
  }

  // Keyboard tugmalarini qayta ishlash
  if (text === "🖼 Suratlar") {
    userStates[chatId] = "waiting_for_image_prompt";
    bot.sendMessage(
      chatId,
      `🎨 Surat uchun matn yuboring.\n\n📋 Maslahatlar:\n• Ingliz tilida yozing (yaxshiroq natija)\n• Aniq va batafsil tasvirlang\n• Misol: "a beautiful sunset over mountains, realistic, 4k"\n\n✍️ Endi matn yuboring:`,
    );
    return;
  }

  // Agar foydalanuvchi surat uchun matn kutayotgan bo'lsa
  if (userStates[chatId] === "waiting_for_image_prompt") {
    await generateImage(chatId, text);
    return;
  }

  if (text === "🎧 Audiolar") {
    bot.sendMessage(chatId, "🎵 Audio funksiyasi hozircha ishlamaydi.");
    return;
  }
});

console.log("🤖 Bot ishga tushdi...");
