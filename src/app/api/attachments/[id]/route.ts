import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: attachment } = await supabase.from("request_attachments").select("storage_path").eq("id", id).single();
  if (!attachment) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await supabase.storage.from("request-attachments").createSignedUrl(attachment.storage_path, 60);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}

