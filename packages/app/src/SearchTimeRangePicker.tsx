import { Form, InputGroup } from 'react-bootstrap';
import cx from 'classnames';
import { useRef, useEffect, useState } from 'react';
import DatePicker from 'react-datepicker';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import { endOfDay, format, sub } from 'date-fns';
import * as chrono from 'chrono-node';

import 'react-datepicker/dist/react-datepicker.css';
import { useHotkeys } from 'react-hotkeys-hook';
import { TimeFormat } from './useUserPreferences';

export function parseTimeRangeInput(str: string): [Date | null, Date | null] {
  const parsedTimeResult = chrono.parse(str);
  const start =
    parsedTimeResult.length === 1
      ? parsedTimeResult[0].start?.date()
      : parsedTimeResult.length > 1
      ? parsedTimeResult[1].start?.date()
      : null;
  const end =
    parsedTimeResult.length === 1 && parsedTimeResult[0].end != null
      ? parsedTimeResult[0].end.date()
      : parsedTimeResult.length > 1 && parsedTimeResult[1].end != null
      ? parsedTimeResult[1].end.date()
      : start != null && start instanceof Date
      ? new Date()
      : null;

  return [start, end];
}

const LIVE_TAIL_TIME_QUERY = 'Live Tail';

export default function SearchTimeRangePicker({
  inputValue,
  setInputValue,
  onSearch,
  showLive = false,
  timeFormat = '24h',
}: {
  inputValue: string;
  setInputValue: (str: string) => any;
  onSearch: (rangeStr: string) => void;
  showLive?: boolean;
  timeFormat?: TimeFormat;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([
    null,
    null,
  ]);

  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  useHotkeys(
    'd',
    () => {
      setIsDatePickerOpen(true);
    },
    { preventDefault: true },
    [setIsDatePickerOpen],
  );

  useEffect(() => {
    if (isDatePickerOpen) {
      inputRef.current?.focus();
    }
  }, [isDatePickerOpen]);

  return (
    <>
      <OverlayTrigger
        rootClose
        onToggle={opened => setIsDatePickerOpen(opened)}
        show={isDatePickerOpen}
        placement="bottom"
        delay={{ show: 0, hide: 0 }}
        overlay={
          <div
            className="pt-2"
            style={{ zIndex: 5 }}
            onKeyDownCapture={e => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                setIsDatePickerOpen(false);
              }
            }}
          >
            <div className="d-flex bg-body border rounded">
              <div className="p-3 pe-4">
                <div className="fs-7 text-muted mb-2">Preset Ranges</div>
                {showLive ? (
                  <div
                    className={cx('fs-7.5 mb-1 cursor-pointer', {
                      'text-white-hover-green':
                        !inputValue.includes(LIVE_TAIL_TIME_QUERY),
                      'text-success': inputValue.includes(LIVE_TAIL_TIME_QUERY),
                    })}
                    onClick={() => {
                      setInputValue(LIVE_TAIL_TIME_QUERY);
                      onSearch(LIVE_TAIL_TIME_QUERY);
                      setIsDatePickerOpen(false);
                    }}
                  >
                    Live Tail
                  </div>
                ) : null}
                {['15m', '1h', '4h', '12h', '1d', '4d', '7d', '30d'].map(
                  value => (
                    <div
                      key={value}
                      className={cx('fs-7.5 mb-1 cursor-pointer', {
                        'text-white-hover-green':
                          inputValue.toLowerCase().replace('past ', '') !==
                          value,
                        'text-success':
                          inputValue.toLowerCase().replace('past ', '') ===
                          value,
                      })}
                      onClick={() => {
                        setInputValue(`Past ${value}`);
                        onSearch(`Past ${value}`);
                        setIsDatePickerOpen(false);
                      }}
                    >
                      Past {value}
                    </div>
                  ),
                )}
              </div>
              <DatePicker
                // Lots of bugs unfortunately https://github.com/Hacker0x01/react-datepicker/issues/1337
                // peekNextMonth
                focusSelectedMonth={false}
                disabledKeyboardNavigation
                inline
                selectsRange
                startDate={dateRange?.[0]}
                endDate={dateRange?.[1]}
                maxDate={new Date()}
                onChange={range => {
                  const formatStr =
                    timeFormat === '24h' ? 'MMM d HH:mm:ss' : 'MMM d h:mm:ss a';
                  setDateRange(range);

                  if (range != null && range[0] != null) {
                    const timeStr = `${format(range[0], formatStr)} - ${
                      range[1] != null
                        ? format(endOfDay(range[1]), formatStr)
                        : ''
                    }`;

                    setInputValue(timeStr);

                    if (range[1] != null) {
                      onSearch(timeStr);
                      setIsDatePickerOpen(false);
                    }
                  }
                }}
                monthsShown={1}
                // calendarContainer={MyContainer}
                // showPreviousMonths
                // focusSelectedMonth={true}
                // monthsShown={2}
              />
            </div>
          </div>
        }
        trigger={['click']}
      >
        <InputGroup className="w-100">
          <InputGroup.Text className="ps-3 pe-0">
            <i className={cx('bi fs-7 text-muted bi-calendar-fill')} />
          </InputGroup.Text>
          <Form.Control
            ref={inputRef}
            className={cx('border-0 fs-7 px-2', {
              'text-success': inputValue.includes(LIVE_TAIL_TIME_QUERY),
            })}
            type="text"
            placeholder={'Date Picker'}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape' && e.target instanceof HTMLInputElement) {
                e.target.blur();
              }
            }}
          />
          {inputValue.includes(LIVE_TAIL_TIME_QUERY) && (
            <InputGroup.Text className="ps-3 pe-0">
              <i className="bi fs-7 text-success bi-lightning-charge-fill me-3" />
            </InputGroup.Text>
          )}
          {isDatePickerOpen ? (
            <InputGroup.Text className="ps-0 pe-3">
              <div
                className="mono px-1 fs-8 text-muted"
                style={{
                  border: '1px solid #37414d',
                  borderRadius: 3,
                  padding: '1px 4px',
                  background: '#626262',
                }}
              >
                d
              </div>
            </InputGroup.Text>
          ) : null}
        </InputGroup>
      </OverlayTrigger>
    </>
  );
}
