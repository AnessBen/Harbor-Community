import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInviteUrl,
  emitTogetherInvite,
  onTogetherInvite,
  onListenInvite,
  parseTogetherDeepLink,
  type ParsedInvite,
} from "../src/lib/together/invite";

test("shared invites use the hosted apex and reach the native invite parser", () => {
  const relay = "wss://relay.example.test/base?region=eu&version=11";
  const shared = new URL(buildInviteUrl(relay, "abc234"));
  assert.equal(shared.origin, "https://harborcommunity.site");
  assert.deepEqual(parseTogetherDeepLink(`harbor://together?${shared.searchParams}`), {
    relayUrl: relay,
    roomCode: "ABC234",
  });
});

test("native invites reject other schemes, malformed relays and incomplete rooms", () => {
  const query = new URLSearchParams({
    "harbor-relay": "wss://relay.example.test",
    "harbor-room": "ABC234",
  });
  assert.equal(parseTogetherDeepLink(`https://together?${query}`), null);
  assert.equal(parseTogetherDeepLink(`harbor://together/other?${query}`), null);
  assert.equal(parseTogetherDeepLink(`harbor://together?${query}&harbor-room=XYZ789`), null);
  for (const relay of [
    "javascript:alert(1)",
    "https://relay.example.test",
    "wss://user:password@relay.example.test",
    "wss://relay.example.test/#fragment",
  ]) {
    query.set("harbor-relay", relay);
    assert.equal(parseTogetherDeepLink(`harbor://together?${query}`), null);
  }
  query.set("harbor-relay", "wss://relay.example.test");
  for (const room of ["ABC", "ABC2345", "ABC-23"]) {
    query.set("harbor-room", room);
    assert.equal(parseTogetherDeepLink(`harbor://together?${query}`), null);
  }
});

test("an invite carrying the retired public relay joins through the replacement", () => {
  const query = new URLSearchParams({
    "harbor-relay": "wss://pub.harbor.site",
    "harbor-room": "ABC234",
  });
  assert.deepEqual(parseTogetherDeepLink(`harbor://together?${query}`), {
    relayUrl: "wss://pub.harborcommunity.site",
    roomCode: "ABC234",
  });
});

test("a launch invite is delivered once when the provider subscribes", () => {
  const invite = { relayUrl: "wss://relay.example.test", roomCode: "ABC234" };
  emitTogetherInvite(invite);
  const received: ParsedInvite[] = [];
  const stop = onTogetherInvite((value) => received.push(value));
  assert.deepEqual(received, [invite]);
  stop();
  const stopNext = onTogetherInvite((value) => received.push(value));
  assert.equal(received.length, 1);
  emitTogetherInvite({ ...invite, roomCode: "XYZ789" });
  assert.equal(received[1].roomCode, "XYZ789");
  stopNext();
});

test("cold-start listening invites survive the watch provider mounting first", () => {
  const url = new URL(buildInviteUrl("wss://relay.example.test", "ltabc234"));
  const invite = parseTogetherDeepLink(`harbor://together?${url.searchParams}`);
  assert.ok(invite);
  emitTogetherInvite(invite);
  const watch: ParsedInvite[] = [];
  const listen: ParsedInvite[] = [];
  const stopWatch = onTogetherInvite((value) => watch.push(value));
  const stopListen = onListenInvite((value) => listen.push(value));
  stopWatch();
  stopListen();
  assert.deepEqual(watch, []);
  assert.deepEqual(listen, [{ relayUrl: "wss://relay.example.test", roomCode: "LTABC234" }]);
});

test("Listen Along carries the public session ID into Harbor and rejects ambiguous invites", () => {
  const sessionId = "5a28e411-6243-4de2-8828-03249824bc9b";
  const relayUrl = "wss://relay.example.test";
  const roomCode = "LTABC234";
  const query = new URL(buildInviteUrl(relayUrl, roomCode, undefined, sessionId)).searchParams;
  const parse = () => parseTogetherDeepLink(`harbor://together?${query}`);
  assert.deepEqual(parse(), { relayUrl, roomCode, sessionId });
  query.append("harbor-session", sessionId);
  assert.equal(parse(), null);
  query.set("harbor-session", "");
  assert.equal(parse(), null);
  query.set("harbor-session", sessionId);
  query.set("harbor-room", "ABC234");
  assert.equal(parse(), null);
});
