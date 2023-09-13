import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import { Button } from 'react-bootstrap';
import { useState } from 'react';

import { FloppyIcon } from './SVGIcons';
import { useWindowSize } from './utils';

export default function SearchPageActionBar({
  onClickConfigAlert,
  onClickDeleteLogView,
  onClickSaveSearch,
  onClickUpdateLogView,
  selectedLogView,
}: {
  onClickConfigAlert: () => void;
  onClickDeleteLogView: () => void;
  onClickSaveSearch: () => void;
  onClickUpdateLogView: () => void;
  selectedLogView: any;
}) {
  const { width } = useWindowSize();
  const [isMoreActionsOpen, setIsMoreActionsOpen] = useState(false);
  const isSmallScreen = (width ?? 1000) < 900;

  return (
    <>
      {!selectedLogView && !isSmallScreen && (
        <Button
          variant="dark"
          className="text-muted-hover mx-2 d-flex align-items-center fs-7"
          style={{ height: 36 }}
          onClick={onClickSaveSearch}
        >
          <div className="d-flex align-items-center">
            <FloppyIcon width={14} />
          </div>
          <span className="d-none d-md-inline ms-2">Save</span>
        </Button>
      )}
      {selectedLogView && !isSmallScreen && (
        <Button
          variant="dark"
          className="text-muted-hover mx-2 d-flex align-items-center fs-7"
          style={{ height: 36 }}
          onClick={onClickUpdateLogView}
        >
          <div className="pe-2 d-flex align-items-center">
            <FloppyIcon width={14} />
          </div>
          Update
        </Button>
      )}
      {!isSmallScreen && (
        <Button
          variant={'dark'}
          className="text-muted-hover me-2 fs-7"
          style={{ height: 36 }}
          // disabled={!selectedLogView}
          onClick={onClickConfigAlert}
        >
          <i className="bi bi-bell-fill fs-7.5" />
          <span className="d-none d-md-inline ms-2">
            {selectedLogView ? 'Alerts' : 'Alert'}
          </span>
        </Button>
      )}
      {(selectedLogView || isSmallScreen) && (
        <OverlayTrigger
          rootClose
          onToggle={opened => setIsMoreActionsOpen(opened)}
          show={isMoreActionsOpen}
          placement="bottom-end"
          delay={{ show: 0, hide: 0 }}
          trigger={['click']}
          overlay={
            <div>
              {isSmallScreen && (
                <>
                  {!selectedLogView && (
                    <div className="d-flex bg-body border rounded mt-2">
                      <Button
                        variant="dark"
                        className="text-muted-hover mx-2 d-flex align-items-center fs-7"
                        style={{ height: 36 }}
                        onClick={onClickSaveSearch}
                      >
                        <div className="d-flex align-items-center">
                          <FloppyIcon width={14} />
                        </div>
                        <span className="ms-2">Save</span>
                      </Button>
                    </div>
                  )}
                  {selectedLogView && (
                    <div className="d-flex bg-body border rounded mt-2">
                      <Button
                        variant="dark"
                        className="text-muted-hover mx-2 d-flex align-items-center fs-7"
                        style={{ height: 36 }}
                        onClick={onClickUpdateLogView}
                      >
                        <div className="pe-2 d-flex align-items-center">
                          <FloppyIcon width={14} />
                        </div>
                        Update
                      </Button>
                    </div>
                  )}
                </>
              )}
              {isSmallScreen && (
                <div className="d-flex bg-body border rounded mt-2">
                  <Button
                    variant={'dark'}
                    className="text-muted-hover me-2 fs-7"
                    style={{ height: 36 }}
                    // disabled={!selectedLogView}
                    onClick={onClickConfigAlert}
                  >
                    <i className="bi bi-bell-fill fs-7.5" />
                    <span className="ms-2">
                      {selectedLogView ? 'Alerts' : 'Alert'}
                    </span>
                  </Button>
                </div>
              )}
              {selectedLogView && (
                <>
                  <div className="d-flex bg-body border rounded mt-2">
                    <Button
                      variant="dark"
                      className="text-muted-hover d-flex align-items-center fs-7 w-100"
                      style={{ height: 36 }}
                      onClick={onClickDeleteLogView}
                    >
                      <i className="me-2 fs-7.5 bi bi-trash-fill" />
                      Delete Saved Search
                    </Button>
                  </div>
                  <div className="d-flex bg-body border rounded mt-2">
                    <Button
                      variant="dark"
                      className="text-muted-hover d-flex align-items-center fs-7 w-100"
                      style={{ height: 36 }}
                      onClick={onClickSaveSearch}
                    >
                      <i className="me-2 fs-7.5 bi bi-plus" />
                      Save as New Search
                    </Button>
                  </div>
                </>
              )}
            </div>
          }
        >
          <Button
            variant="dark"
            className="text-muted-hover"
            style={{ height: 36 }}
          >
            <i className="bi bi-three-dots" />
          </Button>
        </OverlayTrigger>
      )}
    </>
  );
}
