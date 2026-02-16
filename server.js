import TelegramBot from "node-telegram-bot-api";
import express from "express";
import "dotenv/config";
import axios from "axios";
import fs from "fs";

// Express app yaratish
const app = express();
const PORT = process.env.PORT || 3000;

// Bot tokenni tekshirish
if (!process.env.BOT_TOKEN || !process.env.HF_API_KEY) {
  console.error("❌ BOT_TOKEN yoki HF_API_KEY topilmadi!");
  process.exit(1);
}

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Hugging Face API konfiguratsiyasi
const HF_API_KEY = process.env.HF_API_KEY;
const HF_API_URL =
  "https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0";

const botwithAi = [{ key: "images", label: "🖼 Suratlar" }];

// Foydalanuvchi holatini saqlash
const userStates = {};

// Express middleware
app.use(express.json());

// Health check endpoint (Render uchun zarur)
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Bot ishlamoqda ✅",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Status endpoint
app.get("/status", (req, res) => {
  res.json({
    bot: "active",
    activeUsers: Object.keys(userStates).length,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// Ping endpoint
app.get("/ping", (req, res) => {
  res.send("pong");
});

// Keyboard yasash funksiyasi
function buildKeyboard(options) {
  return options.map((option) => [{ text: option.label }]);
}

// /start buyrug'i
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`📥 /start buyrug'i - Chat ID: ${chatId}`);
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

// Hugging Face API orqali surat yaratish - TO'G'RILANGAN
async function generateImage(chatId, prompt) {
  const workingImg = await bot.sendMessage(
    chatId,
    `⏳ Surat yaratish jarayoni boshlandi...\n\nSo'rov: "${prompt}"\n\nIltimos kutib turing...`,
  );

  const file = `generated-image-${Date.now()}.png`;

  try {
    console.log(`🎨 Surat yaratilmoqda: "${prompt}"`);

    // Hugging Face API ga so'rov yuborish - HEADER TO'G'RILANGAN
    const response = await axios({
      method: "post",
      url: HF_API_URL,
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "image/png", // MUHIM: Faqat image/png
      },
      data: {
        inputs: prompt,
      },
      responseType: "arraybuffer", // Binary data olish
      timeout: 120000, // 2 minut
    });

    console.log(`✅ Surat muvaffaqiyatli yaratildi (${response.data.byteLength} bytes)`);

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
    console.error("❌ Xatolik:", error.message);

    let errorMessage = "❌ Texnik nosozlik yuzaga keldi.";

    if (error.response?.data) {
      try {
        const errorText = Buffer.isBuffer(error.response.data)
          ? error.response.data.toString("utf-8")
          : JSON.stringify(error.response.data);
        console.error("API xatoligi:", errorText);

        // Xatolik turlarini aniqlash
        if (errorText.includes("currently loading") || errorText.includes("is currently loading")) {
          errorMessage = "⏳ Model yuklanmoqda. Iltimos 20-30 soniyadan keyin qayta urinib ko'ring!";
        } else if (errorText.includes("Authorization") || errorText.includes("Invalid token")) {
          errorMessage = "❌ API key noto'g'ri yoki yaroqsiz! Iltimos tekshiring.";
        } else if (errorText.includes("Accept type")) {
          errorMessage = "❌ API bilan muammo. Iltimos qayta urinib ko'ring.";
        } else if (errorText.includes("Rate limit")) {
          errorMessage = "⏸ So'rovlar chegarasi oshdi. Bir oz kuting va qayta urinib ko'ring.";
        }
      } catch (e) {
        console.error("Error parse qilishda muammo:", e);
      }
    }

    // HTTP status kodlari bo'yicha
    if (error.response?.status === 400) {
      errorMessage = "❌ Noto'g'ri so'rov. Iltimos boshqa matn bilan urinib ko'ring.";
    } else if (error.response?.status === 401) {
      errorMessage = "❌ API key noto'g'ri yoki yaroqsiz!";
    } else if (error.response?.status === 403) {
      errorMessage = "❌ API ga kirish taqiqlangan. API key ni tekshiring.";
    } else if (error.response?.status === 503) {
      errorMessage = "⏳ Model yuklanmoqda. Iltimos 20-30 soniyadan keyin qayta urinib ko'ring!";
    } else if (error.response?.status === 429) {
      errorMessage = "⏸ So'rovlar soni chegaradan oshdi. Iltimos bir oz kuting.";
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = "⏱ Vaqt tugadi. Model juda sekin ishlayapti. Iltimos qayta urinib ko'ring.";
    }

    try {
      await bot.editMessageText(errorMessage, {
        chat_id: chatId,
        message_id: workingImg.message_id,
      });
    } catch (editError) {
      console.error("Xabarni tahrirlashda xatolik:", editError.message);
      await bot.sendMessage(chatId, errorMessage);
    }

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

// Polling xatolarini qayta ishlash
bot.on("polling_error", (error) => {
  console.error("⚠️ Polling xatoligi:", error.message);
  
  if (error.message.includes("409 Conflict")) {
    console.log("❌ DIQQAT: Bot allaqachon boshqa joyda ishlamoqda!");
    console.log("🔧 Yechim: Barcha boshqa bot instancelarini to'xtating");
  }
});

// Express serverni ishga tushirish
const server = app.listen(PORT, () => {
  console.log(`🌐 Express server ${PORT} portda ishlamoqda`);
  console.log(`🤖 Telegram bot ishga tushdi...`);
  console.log(`📡 API URL: ${HF_API_URL}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\n⏳ Bot va server to\'xtatilmoqda...');
  
  server.close(() => {
    console.log('✅ Express server to\'xtatildi');
  });
  
  await bot.stopPolling();
  console.log('✅ Bot polling to\'xtatildi');
  
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

console.log("🚀 Bot va Express server ishga tushirilmoqda...");