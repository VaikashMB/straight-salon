import type { HolidayDoc } from './holidays.model.js';
import type { HolidayDto } from './holidays.schemas.js';

export const toHolidayDto = (h: HolidayDoc): HolidayDto => ({
  id: h._id.toHexString(),
  date: h.date,
  name: h.name,
});
