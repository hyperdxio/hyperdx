// Easter egg: April Fools 2026 — Detective Noir theme for AI Summarize.

import { EventFacts, fmtDuration, Mood, pick, short } from './helpers';

export function noirSummary(f: EventFacts, mood: Mood): string {
  const lines: string[] = [];

  // Mood-specific openers
  if (mood === 'error') {
    lines.push(
      pick([
        "The call came in at midnight. Something had died in production, and it wasn't pretty.",
        "I'd seen my share of ugly stack traces. This one made the others look like bedtime stories.",
        'The pager screamed like a banshee. I already knew it was going to be a long night.',
        'There was trouble in the cluster. The kind that makes senior engineers update their LinkedIn.',
        "It started with a 3am page. They always start at 3am. Like the system knows when you're deepest in REM.",
        'The dashboard turned red. Not the gentle blush of a warning -- the deep crimson of a five-alarm fire.',
        "I was two sips into my coffee when the incident channel lit up. Should've stayed in bed.",
        "The error rate spiked like a heartbeat on a polygraph. Someone was lying, and it wasn't the metrics.",
        'Production was bleeding out. I grabbed my laptop and started triage. No time for pleasantries.',
        'They found the body in the logs. Cause of death: unhandled exception. Time of death: right now.',
        'Another night, another outage. This city never sleeps, and neither does its infrastructure.',
        'The Slack channel exploded. Fifteen engineers, zero answers. Classic.',
      ]),
    );
  } else if (mood === 'warn') {
    lines.push(
      pick([
        'Something smelled wrong. Not rotten yet, but the kind of wrong that gets worse.',
        "The warning lights were blinking. Nobody pays attention to warnings. That's how they get you.",
        'A yellow light in a world that only cares about red. But I know better.',
        "I've seen this pattern before. Warnings today, incidents tomorrow. The writing was on the wall.",
        'The metrics were nervous. Twitchy. Like a canary that knows the mine air is going bad.',
        "It wasn't an error. Not yet. But I could smell one coming, like rain before a storm.",
        "The warning came in quiet, like a snitch in a back alley. Most people would ignore it. I don't ignore warnings.",
        'Degraded, they called it. Like calling a knife wound a scratch. I knew better.',
        "The system wasn't broken. It was bending. And I've been around long enough to know what comes next.",
      ]),
    );
  } else {
    lines.push(
      pick([
        'The request came in like they all do -- quiet, routine. But in this town, nothing stays routine for long.',
        'Another day, another span. I poured myself a coffee and started reading.',
        "On the surface it looked clean. But I've been doing this too long to trust surfaces.",
        'It was a quiet Tuesday in the cluster. Too quiet. I opened the traces anyway.',
        "The span landed on my desk like a manila folder. Routine, they said. I've heard that before.",
        'I picked up the trace and held it to the light. Sometimes the boring ones hide the best secrets.',
        "Everything looked normal. That's what worried me. Normal is just chaos that hasn't revealed itself yet.",
        'Rain hammered the datacenter windows. Another request, another story nobody would read. Except me.',
        "The trace was unremarkable. That's what they all say before the postmortem.",
      ]),
    );
  }

  if (f.service) {
    const ver = f.serviceVersion ? ` v${f.serviceVersion}` : '';
    const lang = f.sdkLanguage
      ? ` Written in ${f.sdkLanguage} -- you can always tell by the stack traces.`
      : '';
    const deploy = f.k8sDeployment
      ? ` Part of the "${f.k8sDeployment}" outfit.`
      : '';
    lines.push(
      pick([
        `${f.service}${ver} -- I knew the name. It had a rap sheet longer than a Kafka topic.${lang}`,
        `The suspect: ${f.service}${f.serviceVersion ? `, version ${f.serviceVersion}` : ''}. It had been at the scene of every major incident this quarter.${deploy}`,
        `${f.service}${f.serviceVersion ? ` (${f.serviceVersion})` : ''} was involved. Of course it was.${lang}`,
        `${f.service}${f.serviceVersion ? `, build ${f.serviceVersion}` : ''}. I'd seen this one around. It had connections to every service in town.${deploy}`,
        `They called it ${f.service}${f.serviceVersion ? ` -- version ${f.serviceVersion}, fresh off the CI pipeline` : ''}. It had that look. The look of a service with something to hide.${lang}`,
        `${f.service}${f.serviceVersion ? ` (${f.serviceVersion})` : ''} -- a repeat offender. Last seen at the previous incident. And the one before that.${deploy}`,
        `The name on the span said ${f.service}${f.serviceVersion ? `, running ${f.serviceVersion}` : ''}. In my line of work, you learn to recognize the regulars.${lang}`,
        `${f.service}${f.serviceVersion ? `, model year ${f.serviceVersion}` : ''}. New paint job, same old bugs underneath.${deploy}`,
      ]),
    );
  }

  if (f.httpMethod && f.httpUrl) {
    lines.push(
      pick([
        `${f.httpMethod} ${short(f.httpUrl, 50)} -- someone was knocking on the door.`,
        `A ${f.httpMethod} to ${short(f.httpUrl, 50)}. Direct, no nonsense. I respect that in a request.`,
        `The request arrived: ${f.httpMethod} ${short(f.httpUrl, 50)}. Like a stranger walking into a bar and ordering the usual.`,
      ]),
    );
  } else if (f.dbSystem) {
    lines.push(
      pick([
        f.dbStatement
          ? `It was interrogating ${f.dbSystem}: "${short(f.dbStatement, 60)}". Cold. Efficient. No small talk.`
          : `${f.dbSystem} was involved. The database always knows more than it lets on.`,
        `${f.dbSystem}${f.dbStatement ? ` -- "${short(f.dbStatement, 50)}"` : ''}. The old filing cabinet in the back room. Everything ends up there eventually.`,
        `It went straight to ${f.dbSystem}. ${f.dbStatement ? `"${short(f.dbStatement, 50)}" -- ` : ''}The kind of query that knows exactly what it's looking for.`,
      ]),
    );
  } else if (f.rpcService && f.rpcMethod) {
    lines.push(
      pick([
        `An RPC to ${f.rpcService}.${f.rpcMethod}. A handshake in the dark between two services that barely trust each other.`,
        `It dialed ${f.rpcService}, asked for ${f.rpcMethod}. A private conversation between two processes. No witnesses.`,
        `${f.rpcService}.${f.rpcMethod} -- a coded message between accomplices. In microservices, everyone has a handler.`,
      ]),
    );
  } else if (f.messagingSystem) {
    lines.push(
      pick([
        `A message dropped into ${f.messagingSystem}${f.messagingDestination ? ` on "${f.messagingDestination}"` : ''}. Fire and forget. The coward's way out.`,
        `It left a note in ${f.messagingSystem}${f.messagingDestination ? `, addressed to "${f.messagingDestination}"` : ''}. Dead drop protocol. Classic.`,
        `${f.messagingSystem}${f.messagingDestination ? `, channel "${f.messagingDestination}"` : ''} -- an anonymous tip left at the dead drop. No return address.`,
      ]),
    );
  }

  if (f.httpStatus) {
    if (f.httpStatus >= 500)
      lines.push(
        pick([
          `The server answered ${f.httpStatus}. Five hundred. The kind of number that makes oncall reach for the bourbon.`,
          `${f.httpStatus}. The server had given up, like a detective who's seen too much.`,
          `A ${f.httpStatus} came back. The server confessed to everything. It couldn't take the pressure anymore.`,
          `${f.httpStatus}. Internal server error. The kind of internal that means something broke inside and nobody wants to talk about it.`,
        ]),
      );
    else if (f.httpStatus >= 400)
      lines.push(
        pick([
          `A ${f.httpStatus} came back. Wrong credentials at the wrong bar.`,
          `${f.httpStatus}. Denied. The bouncer wasn't impressed with the authentication.`,
          `The response: ${f.httpStatus}. Access denied. Someone didn't have the right papers.`,
        ]),
      );
    else if (f.httpStatus >= 200)
      lines.push(
        pick([
          `${f.httpStatus} -- it survived. But for how long?`,
          `${f.httpStatus}. Success. But in this business, today's 200 is tomorrow's 500.`,
          `A ${f.httpStatus}. Clean getaway. No evidence, no trace. Almost.`,
        ]),
      );
  }

  if (f.durationMs != null) {
    if (f.durationMs > 60_000)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)}. That's not latency, that's a missing persons case.`,
          `${fmtDuration(f.durationMs)}. I've seen cold cases close faster than this request.`,
          `${fmtDuration(f.durationMs)}. The request had gone dark. We were about to file a missing report.`,
        ]),
      );
    else if (f.durationMs > 5000)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)}. An eternity. Somewhere, a user was staring at a spinner, losing faith in technology.`,
          `${fmtDuration(f.durationMs)}. Long enough to make a sandwich. Long enough to regret your career choices.`,
          `${fmtDuration(f.durationMs)}. That's not a response time, that's a hostage situation.`,
        ]),
      );
    else if (f.durationMs > 1000)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)}. Slow enough to notice. Slow enough to worry.`,
          `${fmtDuration(f.durationMs)}. Not catastrophic, but the kind of slow that keeps you up at night.`,
          `${fmtDuration(f.durationMs)}. The request took its sweet time, like a witness who doesn't want to talk.`,
        ]),
      );
    else if (f.durationMs > 0)
      lines.push(
        pick([
          `${fmtDuration(f.durationMs)}. Quick. Maybe too quick. I made a note.`,
          `${fmtDuration(f.durationMs)}. Fast and clean. No time for fingerprints.`,
          `${fmtDuration(f.durationMs)}. In and out before anyone noticed. Professional.`,
        ]),
      );
  }

  if (f.exceptionType) {
    lines.push(
      pick([
        f.exceptionMessage
          ? `Then I found the body -- a ${f.exceptionType}: "${short(f.exceptionMessage, 80)}". The kind of exception that ends careers and starts postmortems.`
          : `A ${f.exceptionType} was waiting in the shadows. It had been there all along.`,
        f.exceptionMessage
          ? `The murder weapon: ${f.exceptionType}. "${short(f.exceptionMessage, 60)}". Left right there in the stack trace for anyone to find.`
          : `A ${f.exceptionType}. The calling card of a serial offender. No message, no remorse.`,
        f.exceptionMessage
          ? `There it was -- ${f.exceptionType}: "${short(f.exceptionMessage, 70)}". I'd seen this MO before.`
          : `${f.exceptionType}. The prime suspect. It had motive, means, and opportunity.`,
      ]),
    );
  }

  if (f.k8sPod) {
    lines.push(
      pick([
        `The trail led to pod "${f.k8sPod}"${f.k8sNamespace ? ` in namespace "${f.k8sNamespace}"` : ''}. A small container in a big city of containers.`,
        `Pod "${f.k8sPod}"${f.k8sNamespace ? `, "${f.k8sNamespace}" district` : ''} -- that was our crime scene. Could be restarted any minute. Evidence doesn't last long in Kubernetes.`,
        `I tracked it to pod "${f.k8sPod}"${f.k8sNamespace ? ` in the "${f.k8sNamespace}" precinct` : ''}. Ephemeral. Could vanish at any moment. The perfect hiding spot.`,
        `Pod "${f.k8sPod}"${f.k8sNamespace ? `, namespace "${f.k8sNamespace}"` : ''} -- a disposable identity in a city full of them. The scheduler could whack it at any time.`,
        `The address: pod "${f.k8sPod}"${f.k8sNamespace ? `, "${f.k8sNamespace}" block` : ''}. A rented room in a flophouse. Month-to-month. No questions asked.`,
        `I found the hideout: "${f.k8sPod}"${f.k8sNamespace ? ` in the "${f.k8sNamespace}" projects` : ''}. Cheap, temporary, scheduled for demolition. Just the way the suspects like it.`,
        `Pod "${f.k8sPod}"${f.k8sNamespace ? `, on the wrong side of "${f.k8sNamespace}"` : ''}. A container with a short lease on life. In this cluster, everybody's just passing through.`,
      ]),
    );
  } else if (f.hostName) {
    lines.push(
      pick([
        `Host "${f.hostName}". I wrote down the address.`,
        `The location: "${f.hostName}". A fixed address in a world of shifting containers.`,
        `"${f.hostName}" -- that's where it all went down. I've got the address on file.`,
      ]),
    );
  }

  if (mood === 'error') {
    lines.push(
      pick([
        'I closed the ticket and stared at the dashboard. Tomorrow there would be another incident. There always is.',
        "Another postmortem to write. I lit a cigarette and started typing. 'Contributing factors: everything.'",
        "The PagerDuty went silent. But I knew it was only sleeping. It's always only sleeping.",
        'The war room emptied. The incident channel went quiet. But the logs would remember.',
        'I updated the status page and closed my laptop. The system was stable. For now.',
        "They'd mark it as resolved in Jira. But some things don't resolve. They just stop being visible.",
        "The RCA would say 'cascading failure.' It always says cascading failure. Nobody ever cascades on purpose.",
        'I marked the incident resolved and poured one out for the failed requests. They never had a chance.',
        'The 5-whys meeting was scheduled for Monday. I already knew the answer to all five: this codebase.',
      ]),
    );
  } else {
    lines.push(
      pick([
        'I filed the trace and poured myself another coffee. The system would live to serve another day.',
        'Case closed. But in distributed systems, nothing ever really ends.',
        "The alerts went quiet. For now. They'd be back. They always come back.",
        'I stamped the trace "resolved" and moved on. The next one was already waiting.',
        'Another clean trace. I should be happy. But clean traces just make me suspicious.',
        'The dashboard went green. But I knew -- they always go red again.',
        'I closed the tab and sipped my coffee. Somewhere out there, a retry was already in flight. They never stop.',
        'The span completed. The trace was closed. But every closed trace is just the prologue to the next incident.',
        "All quiet on the cluster front. I didn't trust it. But I clocked out anyway.",
      ]),
    );
  }

  return lines.join('\n\n');
}
