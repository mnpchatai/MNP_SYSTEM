import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { thumbnailPath } from "../../../../../modules/attachment-image.js";

// Files are streamed through this route instead of redirecting to a signed URL so that
// previews (images, and PDF pages rendered on a canvas) stay same-origin.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const searchParams = new URL(request.url).searchParams;
  const wantsDownload = searchParams.get("download") === "1";
  // ?thumb=1 ส่งภาพย่อ JPEG ที่อัปโหลดคู่กับไฟล์ (ไฟล์เก่าไม่มี ได้ 404 แล้วแกลเลอรีใช้ไฟล์จริงแทน)
  const wantsThumbnail = !wantsDownload && searchParams.get("thumb") === "1";
  const supabase = await createClient();
  const { data: attachment } = await supabase
    .from("request_attachments")
    .select("storage_path, file_name, content_type")
    .eq("id", id)
    .single();
  if (!attachment) return new NextResponse("Not found", { status: 404 });

  const objectPath = wantsThumbnail ? thumbnailPath(attachment.storage_path) : attachment.storage_path;
  const { data, error } = await supabase.storage.from("request-attachments").download(objectPath);
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  const body = await data.arrayBuffer();
  const filename = encodeURIComponent(attachment.file_name);
  return new NextResponse(body, {
    headers: {
      "Content-Type": wantsThumbnail ? "image/jpeg" : attachment.content_type || "application/octet-stream",
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      // Uploads are immutable, but the payload is private to the people who may read the request.
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
