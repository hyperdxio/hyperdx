import React from 'react';
import NextErrorComponent from 'next/error';

const Custom404 = () => {
  return <NextErrorComponent statusCode={404} />;
};

export default Custom404;
