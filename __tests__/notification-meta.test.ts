import { parseAppointmentReplyId } from "@/lib/notification-meta";

// Icons are irrelevant here and lucide ships ESM jest can't parse (jest.mock is hoisted).
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));

// Ids are written by the 0019 `appointments_notify` trigger — keep these in step with it.
const APPT = "3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d";

describe("parseAppointmentReplyId", () => {
  it.each(["scheduled", "declined", "completed", "cancelled"] as const)("parses %s", (kind) => {
    expect(parseAppointmentReplyId(`apptrepl-${APPT}-${kind}`)).toEqual({
      appointmentId: APPT,
      status: kind,
    });
  });

  it("parses suffixed kinds (bumped / moved carry an epoch)", () => {
    expect(parseAppointmentReplyId(`apptrepl-${APPT}-bumped-1764000000`)).toEqual({
      appointmentId: APPT,
      status: "bumped",
    });
    expect(parseAppointmentReplyId(`apptrepl-${APPT}-moved-1764000000`)?.status).toBe("moved");
  });

  it("rejects non-reply ids", () => {
    expect(parseAppointmentReplyId("scan-2026-11-24")).toBeNull();
    expect(parseAppointmentReplyId(`apptreq-${APPT}-${APPT}`)).toBeNull();
    expect(parseAppointmentReplyId(`apptrepl-${APPT}-unknown`)).toBeNull();
  });
});
