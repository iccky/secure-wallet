// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TwoFactorVault
 * @notice On-chain 2-of-2 multisig wallet. Even if seed phrase leaks, 
 *         hacker cannot spend without the guardian signature.
 */
contract TwoFactorVault {
    address public owner;
    address public guardian;
    uint256 public nonce;
    
    event Deposited(address indexed from, uint256 amount);
    event Executed(address indexed to, uint256 value, uint256 nonce);
    event GuardianChanged(address indexed oldGuardian, address indexed newGuardian);
    
    constructor(address _owner, address _guardian) {
        require(_owner != address(0) && _guardian != address(0), "Zero address");
        require(_owner != _guardian, "Owner == Guardian");
        owner = _owner;
        guardian = _guardian;
    }
    
    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }
    
    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        emit Deposited(msg.sender, msg.value);
    }
    
    /**
     * @notice Execute a transaction requiring BOTH signatures.
     */
    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        require(to != address(0), "Invalid recipient");
        require(value <= address(this).balance, "Insufficient balance");
        
        bytes32 txHash = keccak256(abi.encode(
            address(this),
            to,
            value,
            data,
            nonce
        ));
        
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            txHash
        ));
        
        require(recoverSigner(ethSignedHash, ownerSig) == owner, "Invalid owner sig");
        require(recoverSigner(ethSignedHash, guardianSig) == guardian, "Invalid guardian sig");
        
        nonce++;
        
        (bool success, ) = to.call{value: value}(data);
        require(success, "Call failed");
        
        emit Executed(to, value, nonce - 1);
    }
    
    function changeGuardian(
        address newGuardian,
        bytes calldata ownerSig,
        bytes calldata guardianSig
    ) external {
        require(newGuardian != address(0) && newGuardian != owner, "Invalid guardian");
        
        bytes32 txHash = keccak256(abi.encode(
            "CHANGE_GUARDIAN",
            address(this),
            newGuardian,
            nonce
        ));
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            txHash
        ));
        
        require(recoverSigner(ethSignedHash, ownerSig) == owner, "Invalid owner sig");
        require(recoverSigner(ethSignedHash, guardianSig) == guardian, "Invalid guardian sig");
        
        nonce++;
        address oldGuardian = guardian;
        guardian = newGuardian;
        emit GuardianChanged(oldGuardian, newGuardian);
    }
    
    function recoverSigner(bytes32 ethSignedHash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid sig v");
        return ecrecover(ethSignedHash, v, r, s);
    }
    
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
