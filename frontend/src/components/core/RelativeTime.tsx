import moment from "moment";
import { TimeHTMLAttributes, useEffect, useState } from "react";
import { HoverTip } from "./HoverTip";

// One shared ticker keeps every relative timestamp on a page in sync without
// creating one interval per component. Thirty seconds is frequent enough for
// the "seconds/minutes ago" labels while staying negligible for the browser.
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      for (const notify of listeners) notify();
    }, 30_000);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
};

type RelativeTimeProps = TimeHTMLAttributes<HTMLTimeElement> & {
  date: Date | string | number;
};

/**
 * Shows a compact relative timestamp (for example "4 hours ago") and exposes
 * the full localized date and time in a tooltip. The element keeps a machine
 * readable `dateTime` attribute for SEO/accessibility.
 */
const RelativeTime = ({ date, style, ...props }: RelativeTimeProps) => {
  const [now, setNow] = useState<number>();

  useEffect(() => {
    const value = moment(date);
    if (!value.isValid()) return;

    // A page can hold hundreds of timestamps after the lazy listing batches
    // have been revealed. Only re-render when the humanized label actually
    // changes, so a long page does not update every card every thirty seconds.
    const update = () =>
      setNow((previous) => {
        const next = Date.now();
        if (!previous) return next;
        return value.from(moment(next)) === value.from(moment(previous))
          ? previous
          : next;
      });

    update();
    return subscribe(update);
  }, [date]);

  const value = moment(date);
  if (!value.isValid()) return null;

  const relative = now ? value.from(moment(now)) : value.fromNow();
  const full = value.format("LL · LTS");

  return (
    <HoverTip label={full}>
      <time
        {...props}
        dateTime={value.toISOString()}
        style={{ cursor: "help", ...style }}
        suppressHydrationWarning
      >
        {relative}
      </time>
    </HoverTip>
  );
};

export default RelativeTime;
