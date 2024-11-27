// Force ASO to be disabled so that we can use dynamic values for
// publicRuntimeConfig for self-hosted configs
export const getServerSideProps = async () => {
  return {
    props: {},
  };
};
