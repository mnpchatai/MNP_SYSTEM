"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const allowedPhotoTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function fail(message: string): never {
  redirect(`/profile?error=${encodeURIComponent(message)}`);
}

function storagePathFromPublicUrl(url: string) {
  const marker = "/employee-photos/";
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
}

export async function updateOwnPhotoAction(formData: FormData) {
  const employee = await getCurrentEmployee();
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) fail("กรุณาเลือกรูปภาพ");
  if (file.size > 3 * 1024 * 1024) fail("รูปภาพต้องมีขนาดไม่เกิน 3 MB");
  const extension = allowedPhotoTypes[file.type];
  if (!extension) fail("รองรับเฉพาะไฟล์ JPEG, PNG หรือ WebP");

  const storagePath = `${employee.id}/${crypto.randomUUID()}.${extension}`;
  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("employee-photos")
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) fail("อัปโหลดรูปภาพไม่สำเร็จ");

  const { data: publicUrlData } = supabase.storage.from("employee-photos").getPublicUrl(storagePath);
  const { error: rpcError } = await supabase.rpc("app_update_own_photo", { p_photo_url: publicUrlData.publicUrl });
  if (rpcError) {
    await supabase.storage.from("employee-photos").remove([storagePath]);
    fail("บันทึกรูปภาพไม่สำเร็จ");
  }

  const previousPath = employee.photo_url ? storagePathFromPublicUrl(employee.photo_url) : null;
  if (previousPath) await supabase.storage.from("employee-photos").remove([previousPath]);

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  redirect("/profile?photo=updated");
}
