require("dotenv/config");

const {createBundlerClient} = require("viem/account-abstraction");
const {createPublicClient, http, hexToBigInt, erc20Abi, encodePacked} = require("viem");
const {arbitrumSepolia} = require("viem/chains");
const {privateKeyToAccount} = require("viem/accounts");
const {toCircleSmartAccount} = require("@circle-fin/modular-wallets-core");
const {signPermit} = require("./permit.js");


const main = async () => {
    const {getContract} = require('viem')

    const paymasterAddress = process.env.PAYMASTER_V07_ADDRESS;
    const chain = arbitrumSepolia;
    const usdcAddress = process.env.USDC_ADDRESS;
    const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;
    const recipientAddress = process.env.RECIPIENT_ADDRESS;
    const client = createPublicClient({chain, transport: http('https://arbitrum-sepolia.infura.io/v3/f1b89cfe5ac54a12bb2e0d0f6367c61b')});
    const owner = privateKeyToAccount(ownerPrivateKey);

    let account = await toCircleSmartAccount({client, owner});
    // console.log(account.address == '0x15d325f32F0E8E490F80742E48B6a64Bf3349547')
    const usdc = getContract({client, address: usdcAddress, abi: erc20Abi});

    console.log('smart account address:', account.address)

    const usdcBalance = await usdc.read.balanceOf([account.address]);
    if (usdcBalance < 1000000) {
        console.log(
            `Fund ${account.address} with USDC on ${client.chain.name} using https://faucet.circle.com, then run this again.`,
        );
        process.exit();
    }
    const paymaster = {
        async getPaymasterData(parameters) {
            const permitAmount = 10000000n;
            const permitSignature = await signPermit({
                tokenAddress: usdcAddress,
                account,
                client,
                spenderAddress: paymasterAddress,
                permitAmount: permitAmount,
            });

            const paymasterData = encodePacked(
                ["uint8", "address", "uint256", "bytes"],
                [0, usdcAddress, permitAmount, permitSignature],
            );

            return {
                paymaster: paymasterAddress,
                paymasterData,
                paymasterVerificationGasLimit: 200000n,
                paymasterPostOpGasLimit: 15000n,
                isFinal: true,
            };
        },
    };

    const bundlerClient = createBundlerClient({
        account,
        client,
        paymaster,
        userOperation: {
            estimateFeesPerGas: async ({account, bundlerClient, userOperation}) => {
                const {standard: fees} = await bundlerClient.request({
                    method: "pimlico_getUserOperationGasPrice",
                });
                const maxFeePerGas = hexToBigInt(fees.maxFeePerGas);
                const maxPriorityFeePerGas = hexToBigInt(fees.maxPriorityFeePerGas);
                return {maxFeePerGas, maxPriorityFeePerGas};
            },
        },
        transport: http(`https://api.pimlico.io/v2/421614/rpc?apikey=pim_S4kZDgLYefVz5XZ7jq8fGW`),
    });


    const hash = await bundlerClient.sendUserOperation({
        account,
        calls: [
            {
                to: usdc.address,
                abi: usdc.abi,
                functionName: "transfer",
                args: [recipientAddress, 10000n],
            },
        ],
    });
    console.log("UserOperation hash", hash);

    const receipt = await bundlerClient.waitForUserOperationReceipt({hash});
    console.log("Transaction hash", receipt.receipt.transactionHash);
    process.exit();
}

main()
    .catch(err => {
        console.log(`userOperation submission fail` + err)
    })
