"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn print-hide" onClick={() => window.print()}>
      พิมพ์ฟอร์มนี้
    </button>
  );
}
