import chokidar from "chokidar";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const INCOMING_FOLDER = "D:\\Weddinglive\\Incoming";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

let activeWeddingId = null;

console.log("");
console.log("======================================");
console.log("       RIYAZ WEDDING LIVE");
console.log("       PHOTO WATCHER");
console.log("======================================");
console.log("");

console.log("Watching folder:");
console.log(INCOMING_FOLDER);
console.log("");

const allowedExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".cr3",
];

async function loadActiveWedding() {
  try {
    const { data, error } = await supabase
      .from("weddings")
      .select("id, name")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("❌ Failed to find active wedding:");
      console.error(error.message);
      return false;
    }

    if (!data) {
      activeWeddingId = null;

      console.log("");
      console.log("⚠️ No active wedding found.");
      console.log("Create or activate a wedding from the dashboard.");
      console.log("");

      return false;
    }

    activeWeddingId = data.id;

    console.log("");
    console.log("Active wedding:");
    console.log(data.name);
    console.log(data.id);
    console.log("");
    console.log("Waiting for new photos...");
    console.log("");

    return true;
  } catch (error) {
    console.error("❌ Active wedding error:");
    console.error(error);
    return false;
  }
}

async function uploadPhoto(filePath) {
  try {
    const fileName = path.basename(filePath);
    const extension = path.extname(fileName).toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      return;
    }

    if (!activeWeddingId) {
      console.log("");
      console.log("⚠️ Photo detected, but no active wedding exists.");
      console.log(`File: ${fileName}`);
      console.log("");
      return;
    }

    console.log("");
    console.log("📷 NEW PHOTO DETECTED");
    console.log("--------------------------------------");
    console.log(`File: ${fileName}`);
    console.log(`Path: ${filePath}`);
    console.log("--------------------------------------");
    console.log("Uploading to Supabase...");

    const fileBuffer = fs.readFileSync(filePath);

    const storagePath =
      `${activeWeddingId}/${Date.now()}-${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("wedding-photos")
      .upload(storagePath, fileBuffer, {
        contentType: getContentType(extension),
        upsert: false,
      });

    if (uploadError) {
      console.error("❌ Storage upload failed:");
      console.error(uploadError.message);
      return;
    }

    console.log("✅ Photo uploaded to Storage");

    const { error: databaseError } = await supabase
      .from("photos")
      .insert({
        wedding_id: activeWeddingId,
        filename: fileName,
        storage_path: storagePath,
      });

    if (databaseError) {
      console.error("❌ Database insert failed:");
      console.error(databaseError.message);
      return;
    }

    console.log("✅ Photo saved to database");
    console.log("--------------------------------------");
    console.log("🎉 PHOTO DELIVERY COMPLETE");
    console.log("");
  } catch (error) {
    console.error("❌ Upload error:");
    console.error(error);
  }
}

function getContentType(extension) {
  const types = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".cr3": "image/x-canon-cr3",
  };

  return types[extension] || "application/octet-stream";
}

const watcher = chokidar.watch(INCOMING_FOLDER, {
  persistent: true,
  ignoreInitial: true,

  awaitWriteFinish: {
    stabilityThreshold: 1500,
    pollInterval: 100,
  },
});

watcher.on("add", (filePath) => {
  uploadPhoto(filePath);
});

watcher.on("error", (error) => {
  console.error("Watcher error:", error);
});

await loadActiveWedding();