import dayjs from "dayjs";
import "dayjs/locale/pl";

import 'dayjs/locale/pl.js';

import AdvancedFormat from 'dayjs/plugin/advancedFormat.js';
import LocalizedFormat from 'dayjs/plugin/localizedFormat.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import arraySupport from 'dayjs/plugin/arraySupport.js';

import utc from 'dayjs/plugin/utc.js';
import localeData from 'dayjs/plugin/localeData.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import duration from 'dayjs/plugin/duration.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';


dayjs.locale('pl');
dayjs.extend(AdvancedFormat);
dayjs.extend(LocalizedFormat);
dayjs.extend(customParseFormat);
dayjs.extend(arraySupport);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);
dayjs.extend(weekOfYear);
dayjs.extend(duration);
dayjs.extend(utc);
dayjs.extend(localeData);


dayjs.locale("pl");

export default dayjs;
