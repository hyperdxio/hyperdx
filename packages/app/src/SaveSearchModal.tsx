import { FormEvent, useState, useEffect } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { toast } from 'react-toastify';

import api from './api';
import { genEnglishExplanation } from './queryv2';

export default function SaveSearchModal({
  onHide,
  show,
  searchQuery,
  onSaveSuccess,
}: {
  onHide: () => void;
  show: boolean;
  searchQuery: string;
  onSaveSuccess: (responseData: { _id: string }) => void;
}) {
  const saveLogView = api.useSaveLogView();

  const [parsedEnglishQuery, setParsedEnglishQuery] = useState<string>('');

  useEffect(() => {
    genEnglishExplanation(searchQuery).then(q => {
      setParsedEnglishQuery(q);
    });
  }, [searchQuery]);

  const onSubmitLogView = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const target = e.target as typeof e.target & {
      name: { value: string };
    };
    // TODO: fallback to parsedEnglishQuery for better UX ??
    const name = target.name.value || parsedEnglishQuery;

    saveLogView.mutate(
      {
        name,
        query: searchQuery,
      },
      {
        onSuccess: response => {
          onSaveSuccess(response.data);
        },
        onError: () => {
          toast.error(
            'An error occured. Please contact support for more details.',
          );
        },
      },
    );
  };

  return (
    <Modal
      aria-labelledby="contained-modal-title-vcenter"
      centered
      onHide={onHide}
      show={show}
      size="lg"
    >
      <Modal.Body className="bg-grey rounded">
        <h5 className="text-muted">Save Search</h5>
        <Form onSubmit={onSubmitLogView}>
          <Form.Group className="mb-2 mt-4">
            <Form.Label className="text-start text-muted fs-7">
              Query
            </Form.Label>
            <Form.Control
              className="border-0 mb-4 px-3"
              disabled
              placeholder={searchQuery}
              size="sm"
            />
          </Form.Group>
          <Form.Group className="mb-2 mt-2">
            <Form.Label className="text-start text-muted fs-7">Name</Form.Label>
            <Form.Control
              className="border-0 mb-4 px-3"
              id="name"
              name="name"
              placeholder={parsedEnglishQuery}
              size="sm"
              type="text"
              autoFocus
            />
          </Form.Group>
          <Button
            variant="brand-primary"
            className="mt-2 px-4 float-end"
            type="submit"
            size="sm"
          >
            Save
          </Button>
        </Form>
      </Modal.Body>
    </Modal>
  );
}
