'use strict';

// Keep structured logs out of test output; the logger sink is still
// injectable per-test where a suite wants to assert on log lines.
process.env.MOTSE_LOG_LEVEL = 'silent';
