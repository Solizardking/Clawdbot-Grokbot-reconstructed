import {cronJobs} from 'convex/server';
import {internal} from './_generated/api';
const crons=cronJobs();
crons.interval('Remove expired login data',{minutes:10},internal.maintenance.purgeExpired,{});
export default crons;
