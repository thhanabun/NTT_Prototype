// Exercise the public login form rather than bypassing the UI with stored sessions.
export async function loginAdmin(page) {
  await page.getByRole('heading', { name: 'เข้าสู่ระบบ Admin', exact: true }).waitFor();
  await page.getByLabel('Email', { exact: true }).fill('admin@basketly.test');
  await page.getByLabel('Password', { exact: true }).fill('BasketlyDemo123!');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).waitFor();
}
