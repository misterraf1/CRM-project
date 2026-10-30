import { expect, test } from "@playwright/test";
import { signupCompany } from "./helpers";

test("Ctrl+K finds a contact; files on the contact card; @mention picks a colleague", async ({ page }) => {
  await signupCompany(page, "Axtarış MMC");
  const origin = new URL(page.url()).origin;
  const res = await page.request.post("/api/v1/contacts", { data: { name: "Nərgiz Babayeva", email: "nergiz@example.az" }, headers: { origin } });
  const contact = await res.json();

  await page.keyboard.press("Control+k");
  const box = page.getByRole("dialog", { name: "Axtarış" });
  await box.getByRole("combobox").fill("nərgiz");
  await expect(box.getByRole("option", { name: /Nərgiz Babayeva/ })).toBeVisible();
  await box.getByRole("combobox").press("Enter");
  await expect(page).toHaveURL(new RegExp(`/crm/${contact.id}$`));

  // A document on the contact card
  await page.locator('section:has(h2:text-is("Fayllar")) input[type="file"]').setInputFiles({ name: "muqavile.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") });
  await expect(page.getByRole("link", { name: "muqavile.pdf" })).toBeVisible();

  // "@" suggests colleagues; Enter inserts the full name
  const note = page.getByRole("combobox", { name: "Qeyd əlavə et" });
  await note.click();
  await note.pressSequentially("Zəng et @Elv");
  await expect(page.getByRole("listbox").getByRole("option", { name: /Elvin Rzayev/ })).toBeVisible();
  await note.press("Enter");
  await expect(note).toHaveValue("Zəng et @Elvin Rzayev ");
});
