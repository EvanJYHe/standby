export const SHOP_OPEN_TIME = "09:00";
export const SHOP_CLOSE_TIME = "17:00";
export const SHOP_HOURS_LABEL = "Monday to Friday, 9:00 AM to 5:00 PM";
export const SHOP_CLOSED_MESSAGE = "We're closed at that time. We're open Monday through Friday from 9:00 AM to 5:00 PM.";

export function isShopWeekend(weekday: number): boolean {
  return weekday === 6 || weekday === 7;
}
