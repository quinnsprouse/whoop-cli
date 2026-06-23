import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalDayQueryWindow,
  buildSingleLocalDayQueryWindow,
} from "../src/lib/local-day-query-window.mjs";

function durationHours(window) {
  return (Date.parse(window.end) - Date.parse(window.start)) / (60 * 60 * 1000);
}

test("local-day query windows convert local dates to UTC request bounds", () => {
  const scenarios = [
    {
      date: "2026-03-20",
      start: "2026-03-20T04:00:00.000Z",
      end: "2026-03-21T04:00:00.000Z",
      hours: 24,
    },
    {
      date: "2026-03-08",
      start: "2026-03-08T05:00:00.000Z",
      end: "2026-03-09T04:00:00.000Z",
      hours: 23,
    },
    {
      date: "2026-11-01",
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z",
      hours: 25,
    },
  ];

  for (const scenario of scenarios) {
    const window = buildLocalDayQueryWindow({
      flags: { from: scenario.date, to: scenario.date },
      timeZone: "America/New_York",
    });

    assert.equal(window.source, "local-date-window");
    assert.equal(window.fromDate, scenario.date);
    assert.equal(window.toDate, scenario.date);
    assert.equal(window.start, scenario.start);
    assert.equal(window.end, scenario.end);
    assert.equal(durationHours(window), scenario.hours);
  }
});

test("local-day query windows span multi-day DST ranges", () => {
  const spring = buildLocalDayQueryWindow({
    flags: { from: "2026-03-07", to: "2026-03-09" },
    timeZone: "America/New_York",
  });
  assert.equal(spring.start, "2026-03-07T05:00:00.000Z");
  assert.equal(spring.end, "2026-03-10T04:00:00.000Z");
  assert.equal(durationHours(spring), 71);

  const fall = buildLocalDayQueryWindow({
    flags: { from: "2026-10-31", to: "2026-11-02" },
    timeZone: "America/New_York",
  });
  assert.equal(fall.start, "2026-10-31T04:00:00.000Z");
  assert.equal(fall.end, "2026-11-03T05:00:00.000Z");
  assert.equal(durationHours(fall), 73);
});

test("explicit datetime windows normalize independently of local-day timezone", () => {
  const window = buildLocalDayQueryWindow({
    flags: {
      start: "2026-03-20T06:15:30-04:00",
      end: "2026-03-20T08:45:30-04:00",
    },
    timeZone: "America/Los_Angeles",
  });

  assert.equal(window.source, "explicit-datetime");
  assert.equal(window.start, "2026-03-20T10:15:30.000Z");
  assert.equal(window.end, "2026-03-20T12:45:30.000Z");
  assert.equal(window.timeZone, "America/Los_Angeles");
});

test("explicit datetime windows handle repeated and skipped DST hours by offset", () => {
  const spring = buildLocalDayQueryWindow({
    flags: {
      start: "2026-03-08T01:30:00-05:00",
      end: "2026-03-08T03:30:00-04:00",
    },
    timeZone: "America/New_York",
  });
  assert.equal(spring.start, "2026-03-08T06:30:00.000Z");
  assert.equal(spring.end, "2026-03-08T07:30:00.000Z");

  const fall = buildLocalDayQueryWindow({
    flags: {
      start: "2026-11-01T01:30:00-04:00",
      end: "2026-11-01T01:30:00-05:00",
    },
    timeZone: "America/New_York",
  });
  assert.equal(fall.start, "2026-11-01T05:30:00.000Z");
  assert.equal(fall.end, "2026-11-01T06:30:00.000Z");
});

test("single local-day query window uses the same local midnight conversion", () => {
  const window = buildSingleLocalDayQueryWindow({
    date: "2026-11-01",
    timeZone: "America/New_York",
  });

  assert.equal(window.source, "single-local-day");
  assert.equal(window.date, "2026-11-01");
  assert.equal(window.start, "2026-11-01T04:00:00.000Z");
  assert.equal(window.end, "2026-11-02T05:00:00.000Z");
});

test("local-day query window rejects ambiguous or invalid ranges", () => {
  assert.throws(
    () =>
      buildLocalDayQueryWindow({
        flags: { from: "2026-03-21", to: "2026-03-20" },
        timeZone: "America/New_York",
      }),
    /--to .* is before --from/,
  );
  assert.throws(
    () =>
      buildLocalDayQueryWindow({
        flags: { start: "2026-03-20T10:15:30Z" },
        timeZone: "America/New_York",
      }),
    /--start and --end must be provided together/,
  );
  assert.throws(
    () =>
      buildLocalDayQueryWindow({
        flags: {
          start: "2026-03-20T10:15:30Z",
          end: "2026-03-20T10:15:30Z",
        },
        timeZone: "America/New_York",
      }),
    /must be after --start/,
  );
  assert.throws(
    () =>
      buildLocalDayQueryWindow({
        flags: {
          start: "2026-03-20T10:15:30",
          end: "2026-03-20T12:15:30Z",
        },
        timeZone: "America/New_York",
      }),
    /Expected ISO date-time with timezone offset/,
  );
  assert.throws(
    () =>
      buildSingleLocalDayQueryWindow({
        date: "2026-03-20",
        timeZone: "Nope/Nowhere",
      }),
    /Invalid timezone/,
  );
});
