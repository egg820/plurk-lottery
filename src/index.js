const PlurkClient = require("./plurk-client");
const PlurkChannel = require("./plurk-channel");
const MatchingQueue = require("./matching-queue");

const config = require("../config");

const client = new PlurkClient({
  consumerKey: config.consumerKey,
  consumerSecret: config.consumerSecret,
  token: config.token,
  tokenSecret: config.tokenSecret,
});

const botDataPromise = client.request("/APP/Users/me");

const queue = new MatchingQueue({
  canMatch(plurk1, plurk2) {
    return plurk1.user_id !== plurk2.user_id;
  },
});
queue.on("match", handleMatch);
queue.on("error", console.error);

initChannel().catch(console.error);

setInterval(function autoAddFriend() {
  client.request("/APP/Alerts/addAllAsFriends").catch(console.error);
}, 10000);

async function initChannel() {
  const result = await client.request("/APP/Realtime/getUserChannel");
  const channel = new PlurkChannel(result.comet_server, result.channel_name);
  channel.on("plurk", handleNewPlurk);
  channel.on("response", handleNewResponse);
  channel.on("error", console.error);
  await channel.poll();
}

async function handleNewPlurk(plurk) {
  if (!(await isMatchRequest(plurk))) {
    return;
  }

  if (queue.some((item) => item.user_id === plurk.user_id)) {
    await client.request("/APP/Responses/responseAdd", {
      plurk_id: plurk.plurk_id,
      qualifier: ":",
      content: "你已經在配對中囉，請稍候 [error]",
    });
    return;
  }

  queue.push(plurk);
  await client.request("/APP/Responses/responseAdd", {
    plurk_id: plurk.plurk_id,
    qualifier: ":",
    content: "配對中 [loading] \n回覆 取消 可以取消這次配對喔！",
  });
}

async function isMatchRequest(plurk) {
  const botData = await botDataPromise;
  return (
    plurk.user_id !== botData.id &&
    plurk.limited_to === `|${botData.id}||${plurk.user_id}|`
  );
}

async function handleNewResponse(data) {
  const { plurk, response } = data;
  if ((await isMatchRequest(plurk)) && response.user_id === plurk.user_id) {
    const command = response.content_raw.trim();
    if (command === "取消") {
      queue.removeWhere((item) => item.plurk_id === plurk.plurk_id);
      await client.request("/APP/Responses/responseAdd", {
        plurk_id: plurk.plurk_id,
        qualifier: ":",
        content: "幫你取消這次配對了 [error]",
      });
    }
  }
}

async function handleMatch(plurk1, plurk2) {
  const data1 = await getPlurkData(client, plurk1.plurk_id);
  const data2 = await getPlurkData(client, plurk2.plurk_id);
  const MAX_CONTENT_LENGTH = 50;
  const content1 = truncate(plurk1.content_raw, MAX_CONTENT_LENGTH);
  const content2 = truncate(plurk2.content_raw, MAX_CONTENT_LENGTH);
  const newPlurk = await client.request("/APP/Timeline/plurkAdd", {
    qualifier: ":",
    content:
      "配對成功 [ok]\n\n" +
      `@${data1.user.nick_name}: ${content1}\n\n` +
      `@${data2.user.nick_name}: ${content2}`,
    limited_to: JSON.stringify([plurk1.user_id, plurk2.user_id]),
  });
  const newPlurkUrl = plurkUrl(newPlurk.plurk_id);
  await client.request("/APP/Responses/responseAdd", {
    plurk_id: plurk1.plurk_id,
    qualifier: ":",
    content: "配對成功 [ok]\n" + newPlurkUrl,
  });
  await client.request("/APP/Responses/responseAdd", {
    plurk_id: plurk2.plurk_id,
    qualifier: ":",
    content: "配對成功 [ok]\n" + newPlurkUrl,
  });
}

function getPlurkData(client, plurk_id) {
  return client.request("/APP/Timeline/getPlurk", {
    plurk_id,
    minimal_data: true,
    minimal_user: true,
  });
}

function truncate(text, length) {
  if (text.length <= length) {
    return text;
  } else {
    return length === 0 ? "" : text.slice(0, length - 1) + "…";
  }
}

function plurkUrl(plurk_id) {
  return `https://www.plurk.com/p/${plurk_id.toString(36)}`;
}
