// Easter egg: April Fools 2026 — Shakespearean Drama theme for AI Summarize.

import { EventFacts, fmtDuration, Mood, pick, short } from './helpers';

export function shakespeareSummary(f: EventFacts, mood: Mood): string {
  const lines: string[] = [];

  if (mood === 'error') {
    lines.push(
      pick([
        'Friends, engineers, SREs -- lend me your terminals! I come to debug this trace, not to praise it.',
        '"Something is rotten in the state of production." The gravedigger digs through logs.',
        '"Double, double, toil and trouble; server burn and database bubble." The witches have been at the config again.',
        '"O, what a fall was there, my engineers!" A service that once stood proud now lies in ruin.',
        '"Now is the winter of our deployment." And this error hath made it most discontent.',
        '"Cry havoc and let slip the bugs of war!" The error hath breached the gates of production.',
        '"The evil that services do lives after them in the logs; the good is oft interred with their pods."',
        '"If errors be the food of outages, deploy on." The tragedy begins.',
        'Act V. The final act. Where all the retries have been spent and only the stack trace remains.',
        '"We few, we happy few, we band of oncall." Tonight we debug.',
      ]),
    );
  } else if (mood === 'slow') {
    lines.push(
      pick([
        "To retry, or not to retry -- that is the question. Whether 'tis nobler in the cluster to suffer the slings and arrows of outrageous latency...",
        '"How poor are they that have not patience!" The request waits. And waits. And waits still more.',
        '"Delays have dangerous ends." And this delay hath tested the patience of every user in the realm.',
        '"O time, thou must untangle this, not I!" The request hath been waiting since the age of the previous deployment.',
        '"Lord, what fools these timeouts be!" Set too high for the impatient, too low for the database.',
        '"The wheel is come full circle." And yet the request still spins, awaiting a response.',
        '"How weary, stale, flat, and unprofitable seem to me all the uses of this endpoint." For it is slow. So very slow.',
        '"There is nothing either fast or slow, but SLOs make it so." And our SLOs are most unkind.',
        '"If it were done when \'tis done, then \'twere well it were done quickly." But alas, this span knows not the meaning of quickly.',
      ]),
    );
  } else {
    lines.push(
      pick([
        "Hark! What light through yonder load balancer breaks? 'Tis a request, and it beareth tidings.",
        "All the world's a cluster, and all the services merely players. They have their exits and their entrances.",
        '"Brevity is the soul of wit." And so, let us be brief about this span.',
        '"What a piece of work is a microservice!" How noble in architecture, how infinite in endpoints.',
        '"Now is the summer of our uptime," made glorious by this successful span. Long may it last.',
        '"There are more things in Grafana and Datadog, Horatio, than are dreamt of in your runbooks."',
        '"Some are born distributed, some achieve distribution, and some have microservices thrust upon them."',
        '"If metrics be the food of SRE, graph on! Give me excess of it."',
        '"The quality of uptime is not strained. It droppeth as the gentle deploy from heaven."',
        '"Once more unto the endpoint, dear friends, once more."',
        '"O brave new world, that has such services in it!" Let us observe one such wonder.',
        '"Shall I compare thee to a summer deploy? Thou art more stable and more temperate."',
      ]),
    );
  }

  if (f.service) {
    const lang = f.sdkLanguage
      ? ` Forged in the fires of ${f.sdkLanguage} -- a tongue both powerful and perilous.`
      : '';
    const deploy = f.k8sDeployment
      ? ` It serves the house of "${f.k8sDeployment}".`
      : '';
    lines.push(
      pick([
        `Enter ${f.service}${f.serviceVersion ? `, Act ${f.serviceVersion}` : ''} -- a service of noble bearing, yet burdened with a thousand requests upon its shoulders.${lang}`,
        `${f.service}${f.serviceVersion ? ` (v${f.serviceVersion})` : ''} takes the stage. "The readiness is all," it declares, though readiness, like uptime, is never guaranteed.${deploy}`,
        `${f.service}${f.serviceVersion ? `, revision ${f.serviceVersion},` : ''} makes its entrance. "I am not what I am," it warns in its README, and truer words were never committed.${lang}`,
        `The noble ${f.service}${f.serviceVersion ? `, heir to version ${f.serviceVersion}` : ''}, strides upon the stage. Heavy is the head that wears the crown of being a critical service.${deploy}`,
        `Enter stage left: ${f.service}${f.serviceVersion ? `, Act ${f.serviceVersion}, Scene 1` : ''}. "All that glitters is not gold" -- and all that passes health checks is not healthy.${lang}`,
        `${f.service}${f.serviceVersion ? ` (v${f.serviceVersion})` : ''} awakens. "To thine own SLO be true," it whispers to itself. A fine motto. Rarely achieved.${deploy}`,
        `Behold ${f.service}${f.serviceVersion ? `, in its ${f.serviceVersion} incarnation` : ''}! "Though this be madness, yet there is method in it." Or so the architects claim.${lang}`,
      ]),
    );
  }

  if (f.httpMethod && f.httpUrl) {
    lines.push(
      pick([
        `"${f.httpMethod} ${short(f.httpUrl, 40)}!" it cries unto the void. A plea most desperate, cast upon the network winds.`,
        `A ${f.httpMethod} to ${short(f.httpUrl, 40)}. "Once more unto the endpoint!" quoth the client, steeling itself for the response.`,
        `"${f.httpMethod} ${short(f.httpUrl, 40)}" -- the battle cry rings across the network. Whether fortune favors this request remains to be seen.`,
      ]),
    );
  } else if (f.dbSystem) {
    lines.push(
      pick([
        `It doth consult the ${f.dbSystem} oracle${f.dbStatement ? `, whispering: "${short(f.dbStatement, 50)}"` : ''}. The ancient keeper of state, who remembers what all others forget.`,
        `To the ${f.dbSystem} it turns, ${f.dbStatement ? `beseeching: "${short(f.dbStatement, 50)}"` : 'seeking answers in the depths of persistence'}. "The truth will out," sayeth the query optimizer.`,
        `It kneels before ${f.dbSystem}${f.dbStatement ? `, offering this query: "${short(f.dbStatement, 50)}"` : ''}. The database, like the Oracle at Delphi, speaks only in response to those who ask correctly.`,
      ]),
    );
  } else if (f.rpcService && f.rpcMethod) {
    lines.push(
      pick([
        `A messenger dispatched to ${f.rpcService}, bearing word of ${f.rpcMethod}. "Haste thee hence," quoth the caller, "and return with good tidings."`,
        `"Go, bid the soldiers of ${f.rpcService} shoot!" The call to ${f.rpcMethod} is made. The die is cast.`,
        `A herald rides forth to ${f.rpcService}, bearing the scroll of ${f.rpcMethod}. "If it be now, 'tis not to come. If it be not to come, it will timeout now."`,
      ]),
    );
  } else if (f.messagingSystem) {
    lines.push(
      pick([
        `A letter, sealed and sent through ${f.messagingSystem}${f.messagingDestination ? ` unto "${f.messagingDestination}"` : ''}. Fire-and-forget -- the way of cowards and event-driven architectures alike.`,
        `Into the depths of ${f.messagingSystem}${f.messagingDestination ? `, to the "${f.messagingDestination}" mailbox,` : ''} a message is cast. "The readiness is all" -- and the consumer had better be ready.`,
        `A scroll is entrusted to ${f.messagingSystem}${f.messagingDestination ? `, addressed to "${f.messagingDestination}"` : ''}. "Neither a producer nor a consumer be?" Too late for that advice.`,
      ]),
    );
  } else if (f.body) {
    lines.push(
      pick([
        `The message reads: "${short(f.body, 50)}". Words most plain, yet they carry the weight of the entire transaction.`,
        `"${short(f.body, 50)}" -- thus speaks the span. In these humble words, an entire saga is compressed.`,
        `Its dying breath carries these words: "${short(f.body, 50)}". Let the postmortem record them faithfully.`,
      ]),
    );
  }

  if (f.durationMs != null) {
    if (f.durationMs > 60_000)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)}! "O, that this too, too slow request would resolve itself!" The user grows old waiting.`,
          `${fmtDuration(f.durationMs)}! Kingdoms have risen and fallen in less time. "The patient must minister to themselves," for no SRE cometh.`,
          `${fmtDuration(f.durationMs)}. "Age cannot wither it, nor custom stale its infinite... buffering." The loading spinner hath become a permanent fixture.`,
        ]),
      );
    else if (f.durationMs > 5000)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)} -- an age! Methinks the user doth grow weary, staring at the spinning wheel of fortune.`,
          `${fmtDuration(f.durationMs)}. "I wasted time, and now doth time waste me." So too speaks the impatient user.`,
          `${fmtDuration(f.durationMs)}! "How slow this old moon wanes!" quoth the client, watching the progress bar crawl.`,
        ]),
      );
    else if (f.durationMs > 100)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)}. Neither swift as Mercury nor slow as the court bureaucracy.`,
          `${fmtDuration(f.durationMs)}. "The course of true requests never did run smooth," but this one ran... acceptably.`,
          `${fmtDuration(f.durationMs)}. A middling pace. "There is a tide in the affairs of latency," and this one is at a comfortable ebb.`,
        ]),
      );
    else if (f.durationMs > 0)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)} -- swift as Puck himself! "I'll put a girdle round about the earth in forty milliseconds."`,
          `${fmtDuration(f.durationMs)}! "The swiftest hare hath not such feet as this response!" Truly, a span of noble speed.`,
          `${fmtDuration(f.durationMs)}. "Screw your courage to the sticking place!" No courage needed -- it was over before it began.`,
        ]),
      );
  }

  if (f.httpStatus) {
    if (f.httpStatus >= 500)
      lines.push(
        pick([
          `Alas! ${f.httpStatus}! "The fault, dear Brutus, lies not in our clients, but in our servers, that they are overloaded."`,
          `${f.httpStatus}. "Et tu, server?" Even the backend hath betrayed us.`,
          `${f.httpStatus}! "Now cracks a noble server's heart. Good night, sweet service, and flights of 503s sing thee to thy rest."`,
        ]),
      );
    else if (f.httpStatus >= 400)
      lines.push(
        pick([
          `${f.httpStatus} -- rebuffed! "Get thee to a debugger!" cries the gateway.`,
          `A ${f.httpStatus}. "The lady doth protest too much!" The authorization middleware is most unforgiving.`,
          `${f.httpStatus}. "Off with their tokens!" The auth layer shows no mercy to the unauthorized.`,
        ]),
      );
    else if (f.httpStatus >= 200)
      lines.push(
        pick([
          `${f.httpStatus}. "All's well that ends well," quoth the response, though I trust it not entirely.`,
          `${f.httpStatus}! "O happy response!" The request is returned, triumphant, from the field of battle.`,
          `A ${f.httpStatus}. "The rest is 200." Well done. A standing ovation from the load balancer.`,
        ]),
      );
  }

  if (f.exceptionType) {
    lines.push(
      pick([
        `But soft -- what villainy! A ${f.exceptionType} most foul${f.exceptionMessage ? `: "${short(f.exceptionMessage, 60)}"` : ''}! "O villain, villain, smiling, damned villain!"`,
        `"Murder most foul!" A ${f.exceptionType} strikes${f.exceptionMessage ? ` -- "${short(f.exceptionMessage, 60)}"` : ''}. The stack trace tells all.`,
        `"By the pricking of my thumbs, something ${f.exceptionType} this way comes."${f.exceptionMessage ? ` "${short(f.exceptionMessage, 60)}" -- a curse most specific.` : ''} The prophecy is fulfilled.`,
      ]),
    );
  }

  if (f.k8sPod) {
    lines.push(
      pick([
        `The scene is set: pod "${f.k8sPod}"${f.k8sNamespace ? `, in the realm of "${f.k8sNamespace}"` : ''}. A humble vessel upon the Kubernetes sea, subject to the tempests of the scheduler.`,
        `The stage is pod "${f.k8sPod}"${f.k8sNamespace ? `, in the kingdom of "${f.k8sNamespace}"` : ''}. "Uneasy lies the head that wears a crown" -- and uneasier still the pod that exceeds its memory limits.`,
        `Act, Scene: Pod "${f.k8sPod}"${f.k8sNamespace ? `, Realm "${f.k8sNamespace}"` : ''}. "This above all: to thine own resource limits be true." Wise words. Rarely heeded.`,
        `Pod "${f.k8sPod}"${f.k8sNamespace ? `, of the "${f.k8sNamespace}" court` : ''} -- a player upon the Kubernetes stage. "Exit, pursued by an OOMKiller."`,
        `"What's in a name? That which we call pod '${f.k8sPod}' by any other name would consume as many millicores."${f.k8sNamespace ? ` The "${f.k8sNamespace}" registry confirms it.` : ''}`,
        `Pod "${f.k8sPod}"${f.k8sNamespace ? `, vassal to the "${f.k8sNamespace}" duchy` : ''} -- born in a ReplicaSet, fated to die in a rolling update. "Cowards die many times before their deaths; pods but once."`,
        `The Globe: pod "${f.k8sPod}"${f.k8sNamespace ? `, namespace "${f.k8sNamespace}"` : ''}. "All the cluster's a stage, and all the pods merely players." Some have shorter runs than others.`,
      ]),
    );
  } else if (f.hostName) {
    lines.push(
      pick([
        `The stage: host "${f.hostName}". A modest theatre for this drama.`,
        `Host "${f.hostName}" -- the Globe Theatre of our tale. All the requests are merely players upon its stage.`,
        `The scene unfolds upon "${f.hostName}". A sturdy stage, if somewhat showing its age.`,
      ]),
    );
  }

  if (mood === 'error') {
    lines.push(
      pick([
        '"Out, damned error! Out, I say!" Yet still it persists upon the dashboard.',
        'A tale told by an idiot service, full of logs and fury, signifying nothing.',
        '"The rest is silence." ...Until the next on-call rotation.',
        '"Good night, good night! Parting is such sweet 503." The curtain falls on this error.',
        '"Though this be madness, yet there is a JIRA ticket in it." Tomorrow we debug.',
        '"To sleep, perchance to dream of green dashboards." For now, the pager waits.',
        '"All our yesterdays have lit fools the way to dusty stack traces." And tomorrow promises more of the same.',
        '"The fault is not in our stars, but in our deployment pipeline."',
        '"What\'s done cannot be undone." But it can be reverted. Hopefully.',
      ]),
    );
  } else {
    lines.push(
      pick([
        'Exeunt all. The curtain falls upon this span. Yet the next act begins already.',
        '"Parting is such sweet sorrow" -- said no service to any request, ever.',
        'Thus concludes this act. The monitoring continues, as it must.',
        '"We are such stuff as spans are made on, and our little traces are rounded with a timeout."',
        'The players take their bow. The span is done. But like all great theatre, it shall be repeated.',
        '"If all the year were playing holidays, to deploy would be as tedious as to work." The cycle continues.',
        '"The play\'s the thing!" And in this production, every span is a soliloquy.',
        '"All that ends well is 200 OK." And with that, the chorus departs.',
        '"Now is the winter of our deployment made glorious summer by this successful response." Fin.',
        '"To log, or not to log -- there is no question." We log everything. Always. Exeunt.',
      ]),
    );
  }

  return lines.join('\n\n');
}
