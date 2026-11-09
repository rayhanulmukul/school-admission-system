import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:8080";

type ClassSummary = { id: string; availableSeats: number };

function newRegistrationNumber(): string {
  const random = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `9${String(Date.now()).slice(-10)}${random}`;
}

async function createClass(request: APIRequestContext, totalSeats: number): Promise<string> {
  const name = `E2E Class ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const response = await request.post(`${apiURL}/classes`, {
    data: { name, totalSeats, admissionFee: 0 },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as ClassSummary;
  return body.id;
}

async function getAvailableSeats(request: APIRequestContext, classId: string): Promise<number> {
  const response = await request.get(`${apiURL}/classes/${classId}`);
  const body = (await response.json()) as ClassSummary;
  return body.availableSeats;
}

async function applyForClass(page: Page, classId: string, registrationNumber: string) {
  await page.goto("/");
  const card = page.locator(`#class-${classId}`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /Apply for this class/ }).click();

  await page.getByPlaceholder("As written on the birth certificate").fill("E2E Student");
  await page.getByPlaceholder("17-digit number from the birth certificate").fill(registrationNumber);
  await page.locator("form.reserve-form button[type=submit]").click();
}

test("student reserves a seat and completes admission", async ({ page, request }) => {
  const classId = await createClass(request, 2);
  const registrationNumber = newRegistrationNumber();

  await applyForClass(page, classId, registrationNumber);
  await expect(page.getByText("Seat reserved for")).toBeVisible();
  expect(await getAvailableSeats(request, classId)).toBe(1);

  await page.getByRole("button", { name: /Complete admission/ }).click();
  await expect(page.getByText("Admission complete")).toBeVisible();
});

test("same registration number cannot apply to a second class", async ({ page, request }) => {
  const firstClassId = await createClass(request, 2);
  const secondClassId = await createClass(request, 2);
  const registrationNumber = newRegistrationNumber();

  await applyForClass(page, firstClassId, registrationNumber);
  await expect(page.getByText("Seat reserved for")).toBeVisible();

  await applyForClass(page, secondClassId, registrationNumber);
  await expect(page.locator(".notice-banner.error-notice")).toBeVisible();
  expect(await getAvailableSeats(request, secondClassId)).toBe(2);
});

test("full class disables the apply button", async ({ page, request }) => {
  const classId = await createClass(request, 1);
  const holdResponse = await request.post(`${apiURL}/classes/${classId}/holds`, {
    headers: { "X-Student-Id": newRegistrationNumber() },
    data: { studentName: "Seat Holder" },
  });
  expect(holdResponse.status()).toBe(201);

  await page.goto("/");
  const card = page.locator(`#class-${classId}`);
  await expect(card).toBeVisible();
  await expect(card.getByText("Class Full")).toBeVisible();
  await expect(card.getByRole("button", { name: /Apply for this class/ })).toBeDisabled();
});
