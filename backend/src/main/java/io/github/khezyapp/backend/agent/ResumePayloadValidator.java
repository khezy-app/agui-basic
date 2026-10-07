package io.github.khezyapp.backend.agent;

import java.util.Map;

/**
 * Mirrors the FE-12 payload validator (BE-09 §4.4 / §6): the backend never executes the
 * mutation, so the resume payload is the one piece of the approval contract that crosses the
 * wire un-owned. The card renders from it, the model is re-prompted on top of it, and this
 * helper answers "is this payload one of the documented cases?" without throwing.
 *
 * <p>The four legal shapes, all of which FE-12 and {@link ResumePayloadValidator} must agree
 * on, are documented in the BE-09 handoff entry. This class is deliberately dependency-free:
 * it is the same logic the frontend implements in TypeScript, so a drift on either side
 * shows up as a mismatch against these exact constants.
 */
public final class ResumePayloadValidator {

    private ResumePayloadValidator() {
    }

    /** Envelope of a RESOLVED resume: the payload only makes sense when `approved` answers it. */
    public static boolean hasApprovedFlag(Map<String, Object> payload) {
        return payload != null
                && payload.get("approved") instanceof Boolean;
    }

    /** Approved with a result: the REST response verbatim. Never both `result` and `error`. */
    public static boolean isApprovedSuccess(Map<String, Object> payload) {
        if (!Boolean.TRUE.equals(payload == null ? null : payload.get("approved"))) {
            return false;
        }
        return payload.get("result") instanceof Map
                && !(payload.get("error") instanceof String);
    }

    /** Approved but the REST call failed: an `error` sentence, never a fake success. */
    public static boolean isApprovedFailure(Map<String, Object> payload) {
        if (!Boolean.TRUE.equals(payload == null ? null : payload.get("approved"))) {
            return false;
        }
        return payload.get("error") instanceof String
                && !(payload.get("result") instanceof Map);
    }

    /** Rejected: the user's words, so the model can offer a real alternative. */
    public static boolean isRejected(Map<String, Object> payload) {
        return payload != null
                && Boolean.FALSE.equals(payload.get("approved"))
                && payload.get("reason") instanceof String;
    }

    /**
     * The payload the frontend should produce for the four documented cases. Anything
     * missing `approved`, or both-and-neither `result`/`error`, is not one of them.
     */
    public static boolean isDocumented(Map<String, Object> payload) {
        return isApprovedSuccess(payload) || isApprovedFailure(payload) || isRejected(payload);
    }
}
