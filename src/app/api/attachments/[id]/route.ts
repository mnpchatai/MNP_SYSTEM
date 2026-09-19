import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Files are streamed through this route instead of redirecting to a signed URL so that
// previews (images, and PDF pages rendered on a canvas) stay same-origin.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
  const supabase = await createClient();
  const { data: attachment } = await supabase
    .from("request_attachments")
    .select("storage_path, file_name, content_type")
    .eq("id", id)
    .single();
  if (!attachment) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage.from("request-attachments").download(attachment.storage_path);
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  const body = await data.arrayBuffer();
  const filename = encodeURIComponent(attachment.file_name);
  return new NextResponse(body, {
    headers: {
      "Content-Type": attachment.content_type || "application/octet-stream",
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename*=UTF-8''${filename}`,
      // Uploads are immutable, but the payload is private to the people who may read the request.
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
