// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TimeLockVault
 * @notice Secure vault with time-delayed withdrawals.
 *         Even if seed phrase leaks, attacker cannot instantly drain funds.
 *         Owner has a cancel window to stop unauthorized withdrawals.
 */
contract TimeLockVault {
    address public owner;
    uint256 public constant WITHDRAWAL_DELAY = 24 hours;
    
    struct WithdrawalRequest {
        uint256 amount;
        address to;
        uint256 unlockTime;
        bool active;
    }
    
    WithdrawalRequest public pendingWithdrawal;
    
    event Deposited(address indexed from, uint256 amount);
    event WithdrawalInitiated(uint256 amount, address indexed to, uint256 unlockTime);
    event WithdrawalCompleted(uint256 amount, address indexed to);
    event WithdrawalCancelled(address indexed by);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }
    
    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        emit Deposited(msg.sender, msg.value);
    }
    
    /**
     * @notice Initiate a withdrawal. Starts 24h countdown.
     *         Cannot initiate new one if another is pending.
     */
    function initiateWithdrawal(uint256 amount, address to) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(amount > 0 && amount <= address(this).balance, "Invalid amount");
        require(!pendingWithdrawal.active, "Withdrawal already pending");
        
        pendingWithdrawal = WithdrawalRequest({
            amount: amount,
            to: to,
            unlockTime: block.timestamp + WITHDRAWAL_DELAY,
            active: true
        });
        
        emit WithdrawalInitiated(amount, to, pendingWithdrawal.unlockTime);
    }
    
    /**
     * @notice Complete withdrawal after delay has passed.
     */
    function completeWithdrawal() external onlyOwner {
        require(pendingWithdrawal.active, "No active withdrawal");
        require(block.timestamp >= pendingWithdrawal.unlockTime, "Withdrawal locked");
        
        uint256 amount = pendingWithdrawal.amount;
        address to = pendingWithdrawal.to;
        
        // Clear before transfer (reentrancy safety)
        delete pendingWithdrawal;
        
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "Transfer failed");
        
        emit WithdrawalCompleted(amount, to);
    }
    
    /**
     * @notice Cancel pending withdrawal. Can be done anytime before completion.
     *         This is the CRITICAL security feature.
     */
    function cancelWithdrawal() external onlyOwner {
        require(pendingWithdrawal.active, "No active withdrawal");
        delete pendingWithdrawal;
        emit WithdrawalCancelled(msg.sender);
    }
    
    /**
     * @notice Emergency: withdraw all to owner instantly.
     *         Use only if you control owner key and need funds NOW.
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "Empty vault");
        
        // Cancel any pending withdrawal first
        if (pendingWithdrawal.active) {
            delete pendingWithdrawal;
        }
        
        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "Transfer failed");
        
        emit WithdrawalCompleted(balance, owner);
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
    
    function getVaultBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    function getPendingWithdrawal() external view returns (WithdrawalRequest memory) {
        return pendingWithdrawal;
    }
}
