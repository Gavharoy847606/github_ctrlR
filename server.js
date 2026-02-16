import TelegramBot from "node-telegram-bot-api";
import express from "express";
import 'dotenv/config'
import axios from "axios";
import fs from "fs";

// Express app yaratish
const app = express();
const PORT =  7779;

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

// Hugging Face API konfiguratsiyasi
const HF_API_KEY = process.env.HF_API_KEY;
const HF_API_URL =
  "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0";

const botwithAi = [{ key: "images", label: "🖼 Suratlar" }];

// Foydalanuvchi holatini saqlash
const userStates = {};

// Express middleware
app.use(express.json());

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Bot ishlamoqda",
    timestamp: new Date().toISOString(),
  });
});

// Bot status endpoint
app.get("/status", (req, res) => {
  res.json({
    bot: "active",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

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
      },
      data: {
        inputs: prompt,
      },
      responseType: "arraybuffer",
      timeout: 60000,
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

    let errorMessage = "❌ Texnik nosozlik yuzaga keldi.";

    if (error.response?.data) {
      try {
        const errorText = Buffer.isBuffer(error.response.data)
          ? error.response.data.toString("utf-8")
          : JSON.stringify(error.response.data);
        console.error("API xatoligi:", errorText);

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

  if (text && text.startsWith("/")) {
    return;
  }

  if (text === "🖼 Suratlar") {
    userStates[chatId] = "waiting_for_image_prompt";
    bot.sendMessage(
      chatId,
      `🎨 Surat uchun matn yuboring.\n\n📋 Maslahatlar:\n• Ingliz tilida yozing (yaxshiroq natija)\n• Aniq va batafsil tasvirlang\n• Misol: "a beautiful sunset over mountains, realistic, 4k"\n\n✍️ Endi matn yuboring:`,
    );
    return;
  }

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
  console.error("Polling xatoligi:", error.message);
  
  if (error.message.includes("409 Conflict")) {
    console.log("⚠️ Bot allaqachon boshqa joyda ishlamoqda!");
    process.exit(1);
  }
});

// Express serverni ishga tushirish
app.listen(PORT, () => {
  console.log(`🌐 Express server ${PORT} portda ishlamoqda`);
  console.log(`🤖 Telegram bot ishga tushdi...`);
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('Bot va server to\'xtatilmoqda...');
  bot.stopPolling();
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('Bot va server to\'xtatilmoqda...');
  bot.stopPolling();
  process.exit(0);
});