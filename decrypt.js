// decrypt.js
const fs = require('fs');
const { Wallet } = require('ethers');

async function main() {
    try {
        // Read your exported keystore file
        const keystore = fs.readFileSync('./account.json', 'utf8');
        
        // Put the password you just typed in the terminal here
        const password = 'Ricks1604'; 
        
        console.log('Decrypting... (this can take 3-5 seconds to prevent brute force attacks)');
        
        // Decrypt it to reveal the raw key
        const wallet = await Wallet.fromEncryptedJson(keystore, password);
        
        console.log('\n✅ Success! Here is your raw private key for .env.local:');
        console.log(wallet.privateKey);
        console.log('\n(Do not share this key with anyone!)');
    } catch (error) {
        console.error("Failed to decrypt:", error.message);
    }
}
main();